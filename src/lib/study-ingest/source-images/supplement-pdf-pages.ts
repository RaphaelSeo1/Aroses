import type { SupabaseClient } from "@supabase/supabase-js";
import type { CourseStructurePlan } from "@/lib/ai/course-payload";
import type { PersistedIngestChunk } from "@/lib/source-attribution";
import type { IngestSourceFileRef } from "@/lib/study-ingest/job-extract";
import {
  getPdfPageCount,
  renderPdfPagesToPng,
} from "@/lib/study-ingest/source-images/render-pdf-page";
import type { RawSourceImage } from "@/lib/study-ingest/source-images/types";
import { parsePageNumbersFromPosition } from "@/lib/study-ingest/chunk-position";
import type { IngestSourceImageRecord } from "@/lib/study-ingest/source-images/types";
import { runCropFirstExtract } from "@/lib/pdf-ingest/crop-first-extract";
import {
  filterCroppedFiguresOnly,
} from "@/lib/study-ingest/source-images/is-page-render";
import type { PageTableExtraction } from "@/lib/study-ingest/source-images/extract-pdf-page-tables";
import { STUDY_PDF_INGEST_BUCKET } from "@/lib/study-pdf-ingest";

function envPositiveInt(name: string, fallback: number, max: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(max, Math.floor(n));
}

/** Default budgets cover full lecture PDFs with headroom. */
const MAX_PAGES_RENDERED_PER_PDF = envPositiveInt(
  "PDF_INGEST_MAX_PAGE_RENDERS_PER_PDF",
  120,
  250
);
const MAX_PAGES_RENDERED_PER_JOB = envPositiveInt(
  "PDF_INGEST_MAX_PAGE_RENDERS_PER_JOB",
  160,
  300
);
const RENDER_BATCH_SIZE = envPositiveInt(
  "PDF_INGEST_PAGE_RENDER_BATCH_SIZE",
  8,
  24
);

export type SupplementPdfPagesResult = {
  images: IngestSourceImageRecord[];
  pageTableExtractions: PageTableExtraction[];
  /** In-memory page PNGs from this enrich pass. */
  renderedPageBuffers: RawSourceImage[];
  /** PDF bytes for the primary file. */
  primaryPdfBuffer: Buffer | null;
  primaryFileName: string;
  /** Unified pipeline page artifacts (tables + figures). */
  pageArtifacts: import("@/lib/study-ingest/inject-pdf-tables-into-module").IngestPageArtifacts;
};

function isFullPageLabel(label: string): boolean {
  return /^Page \d+$/i.test(label.trim());
}

function filesMatch(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function parseSectionNumber(position: string): number | null {
  const m = position.match(/\bsection\s+(\d+)\b/i);
  if (!m) return null;
  const n = Number.parseInt(m[1]!, 10);
  return Number.isFinite(n) ? n : null;
}

function chunkIdsReferencedByPlan(plan: CourseStructurePlan | null): Set<string> {
  const ids = new Set<string>();
  if (!plan) return ids;
  for (const mod of plan.modules) {
    for (const lesson of mod.lessons) {
      for (const id of lesson.source_chunk_ids) ids.add(id);
    }
  }
  return ids;
}

function pagesWithEmbeddedImages(
  images: IngestSourceImageRecord[],
  fileName: string
): Set<number> {
  const covered = new Set<number>();
  for (const img of images) {
    if (!filesMatch(img.sourceFileName, fileName)) continue;
    if (img.anchorType === "page" && img.anchorIndex > 0) {
      covered.add(img.anchorIndex);
    }
  }
  return covered;
}

/**
 * Estimate PDF page numbers from ingest chunks referenced by the structure plan.
 * PDF text chunks use section ordinals; we map section → page proportionally.
 */
export function targetPdfPagesForFile(input: {
  fileName: string;
  pageCount: number;
  chunks: PersistedIngestChunk[];
  plan: CourseStructurePlan | null;
}): number[] {
  const { fileName, pageCount, chunks, plan } = input;
  if (pageCount <= 0) return [];

  const referenced = chunkIdsReferencedByPlan(plan);
  const fileChunks = chunks.filter(
    (c) =>
      filesMatch(c.sourceFileName, fileName) &&
      (referenced.size === 0 || referenced.has(c.id))
  );
  if (fileChunks.length === 0) return [];

  let sectionMax = 0;
  for (const c of fileChunks) {
    const s = parseSectionNumber(c.position);
    if (s !== null && s > sectionMax) sectionMax = s;
  }

  const pages = new Set<number>();
  for (const chunk of fileChunks) {
    const fromPosition = parsePageNumbersFromPosition(chunk.position);
    if (fromPosition.length > 0) {
      for (const p of fromPosition) {
        pages.add(Math.min(pageCount, Math.max(1, p)));
      }
      continue;
    }
    const section = parseSectionNumber(chunk.position);
    if (section !== null && sectionMax > 0) {
      const estimated = Math.round((section / sectionMax) * pageCount);
      pages.add(Math.min(pageCount, Math.max(1, estimated)));
    }
  }

  return [...pages].sort((a, b) => a - b);
}

/**
 * Pages to render and scan for visuals — decoupled from structure-plan chunk refs.
 * Scans 1..min(pageCount, budget) so mid-document figures are not orphaned when
 * the plan only cites head/tail chunks.
 */
export function targetPdfPagesForVision(input: {
  fileName: string;
  pageCount: number;
  chunks: PersistedIngestChunk[];
  maxPages?: number;
}): number[] {
  const max = input.maxPages ?? MAX_PAGES_RENDERED_PER_PDF;
  const cap = Math.min(input.pageCount, max);
  if (cap <= 0) return [];

  const pages = new Set<number>();
  for (let p = 1; p <= cap; p++) pages.add(p);

  const fileChunks = input.chunks.filter((c) =>
    filesMatch(c.sourceFileName, input.fileName)
  );
  for (const chunk of fileChunks) {
    for (const p of parsePageNumbersFromPosition(chunk.position)) {
      if (p >= 1 && p <= input.pageCount) pages.add(p);
    }
  }

  return [...pages].sort((a, b) => a - b);
}

function isVisionAllPagesEnabled(): boolean {
  const raw = process.env.PDF_INGEST_VISION_ALL_PAGES?.trim();
  return raw === "1" || raw?.toLowerCase() === "true";
}

/**
 * Balance speed vs coverage: small decks scan every page; large decks focus on
 * plan-referenced pages plus head/tail unless PDF_INGEST_VISION_ALL_PAGES=1.
 */
export function resolveVisionTargetPages(input: {
  fileName: string;
  pageCount: number;
  chunks: PersistedIngestChunk[];
  plan: CourseStructurePlan | null;
}): number[] {
  const fullScanThreshold = envPositiveInt(
    "PDF_INGEST_FULL_VISION_PAGE_THRESHOLD",
    80,
    250
  );
  if (isVisionAllPagesEnabled() || input.pageCount <= fullScanThreshold) {
    return targetPdfPagesForVision(input);
  }

  const maxVision = envPositiveInt("PDF_INGEST_MAX_VISION_PAGES", 120, 250);
  const pages = new Set<number>();

  const planPages = targetPdfPagesForFile({
    fileName: input.fileName,
    pageCount: input.pageCount,
    chunks: input.chunks,
    plan: input.plan,
  });
  for (const p of planPages) pages.add(p);

  for (const chunk of input.chunks.filter((c) =>
    filesMatch(c.sourceFileName, input.fileName)
  )) {
    for (const p of parsePageNumbersFromPosition(chunk.position)) {
      if (p >= 1 && p <= input.pageCount) pages.add(p);
    }
  }

  const head = Math.min(8, input.pageCount);
  for (let p = 1; p <= head; p++) pages.add(p);
  const tailStart = Math.max(1, input.pageCount - 4);
  for (let p = tailStart; p <= input.pageCount; p++) pages.add(p);

  return [...pages]
    .filter((p) => p >= 1 && p <= input.pageCount)
    .sort((a, b) => a - b)
    .slice(0, maxVision);
}

async function downloadPdfBuffer(
  admin: SupabaseClient,
  storagePath: string
): Promise<Buffer | null> {
  const { data: blob, error } = await admin.storage
    .from(STUDY_PDF_INGEST_BUCKET)
    .download(storagePath);
  if (error || !blob) {
    console.warn("[supplementPdfPageFigures] download", storagePath, error?.message);
    return null;
  }
  return Buffer.from(await blob.arrayBuffer());
}

function isPdfRef(ref: IngestSourceFileRef): boolean {
  if (ref.kind === "pdf") return true;
  if (ref.kind != null) return false;
  const name = (ref.originalFileName ?? ref.storagePath).toLowerCase();
  return name.endsWith(".pdf");
}

/**
 * After structure planning, render PDF pages that lessons reference but that
 * had no embedded raster figure extracted (typical for vector slide exports).
 */
export async function supplementPdfPageFigures(input: {
  admin: SupabaseClient;
  userId: string;
  jobId: string;
  chunks: PersistedIngestChunk[];
  plan: CourseStructurePlan | null;
  existingImages: IngestSourceImageRecord[];
  sourceFiles: IngestSourceFileRef[] | null;
  primaryStoragePath: string;
  primaryFileName: string | null;
  /** When set, skip storage download for the primary PDF (same-process ingest). */
  primaryPdfBuffer?: Buffer | null;
  /** Page count from text extract when pdf.js render load fails in dev bundles. */
  knownPageCount?: number;
}): Promise<SupplementPdfPagesResult> {
  const refs: IngestSourceFileRef[] =
    input.sourceFiles && input.sourceFiles.length > 0
      ? input.sourceFiles
      : [
          {
            storagePath: input.primaryStoragePath,
            originalFileName: input.primaryFileName,
            kind: "pdf",
          },
        ];

  const pdfRefs = refs.filter(isPdfRef);
  if (pdfRefs.length === 0) {
    return {
      images: input.existingImages,
      pageTableExtractions: [],
      renderedPageBuffers: [],
      primaryPdfBuffer: null,
      primaryFileName: "upload.pdf",
      pageArtifacts: { tables: {}, figures: [] },
    };
  }

  const toUpload: Awaited<ReturnType<typeof renderPdfPagesToPng>> = [];
  let primaryPdfBuffer: Buffer | null = input.primaryPdfBuffer ?? null;
  let primaryFileName =
    typeof input.primaryFileName === "string" && input.primaryFileName.trim()
      ? input.primaryFileName.trim()
      : "upload.pdf";
  let renderedCount = 0;
  const remainingBudget = MAX_PAGES_RENDERED_PER_JOB;
  const skipReasons: string[] = [];
  if (remainingBudget <= 0) {
    skipReasons.push("page_render_budget_zero");
    console.warn("[supplementPdfPageFigures] skipped — render budget is 0", {
      jobId: input.jobId,
    });
    return {
      images: filterCroppedFiguresOnly(input.existingImages),
      pageTableExtractions: [],
      renderedPageBuffers: [],
      primaryPdfBuffer,
      primaryFileName,
      pageArtifacts: { tables: {}, figures: [] },
    };
  }

  for (const ref of pdfRefs) {
    if (renderedCount >= remainingBudget) break;

    const fileName =
      typeof ref.originalFileName === "string" && ref.originalFileName.trim()
        ? ref.originalFileName.trim()
        : "upload.pdf";

    const isPrimary =
      ref.storagePath === input.primaryStoragePath ||
      (pdfRefs.length === 1 && !primaryPdfBuffer);

    let buffer: Buffer | null = null;
    if (isPrimary && primaryPdfBuffer) {
      buffer = primaryPdfBuffer;
    } else {
      buffer = await downloadPdfBuffer(input.admin, ref.storagePath);
    }
    if (!buffer) {
      skipReasons.push(`download_failed:${ref.storagePath}`);
      continue;
    }

    if (!primaryPdfBuffer) {
      primaryPdfBuffer = buffer;
      primaryFileName = fileName;
    }

    let pageCount = await getPdfPageCount(buffer);
    if (pageCount <= 0 && buffer.length > 1000) {
      const retryBuf = Buffer.from(buffer);
      const retryCount = await getPdfPageCount(retryBuf);
      if (retryCount > 0) {
        buffer = retryBuf;
        pageCount = retryCount;
        primaryPdfBuffer = retryBuf;
      }
    }
    if (pageCount <= 0 && ref.storagePath) {
      const fresh = await downloadPdfBuffer(input.admin, ref.storagePath);
      if (fresh && fresh.length > 1000) {
        const freshCount = await getPdfPageCount(fresh);
        if (freshCount > 0) {
          buffer = fresh;
          pageCount = freshCount;
          primaryPdfBuffer = fresh;
          console.info("[supplementPdfPageFigures] recovered PDF via re-download", {
            jobId: input.jobId,
            fileName,
            pageCount: freshCount,
          });
        }
      }
    }
    if (pageCount <= 0 && input.knownPageCount && input.knownPageCount > 0) {
      pageCount = input.knownPageCount;
      console.info("[supplementPdfPageFigures] using known page count from text extract", {
        jobId: input.jobId,
        fileName,
        pageCount,
      });
    }
    if (pageCount <= 0) {
      skipReasons.push(`page_count_zero:${fileName}`);
      continue;
    }

    const targetPages = resolveVisionTargetPages({
      fileName,
      pageCount,
      chunks: input.chunks,
      plan: input.plan,
    });
    if (targetPages.length === 0) {
      skipReasons.push(`no_target_pages:${fileName}`);
      continue;
    }

    // Render pages in memory for vision crop (never uploaded as full-page figures).
    let remainingToRender = [...targetPages];
    let fileRendered = 0;

    while (
      remainingToRender.length > 0 &&
      renderedCount < remainingBudget &&
      fileRendered < MAX_PAGES_RENDERED_PER_PDF
    ) {
      const room = Math.min(
        RENDER_BATCH_SIZE,
        remainingToRender.length,
        MAX_PAGES_RENDERED_PER_PDF - fileRendered,
        remainingBudget - renderedCount
      );
      if (room <= 0) break;

      const batch = remainingToRender.slice(0, room);
      const rendered = await renderPdfPagesToPng(buffer, batch, fileName);
      toUpload.push(...rendered);
      renderedCount += rendered.length;
      fileRendered += rendered.length;
      remainingToRender = remainingToRender.slice(batch.length);

      console.info("[supplementPdfPageFigures]", {
        jobId: input.jobId,
        fileName,
        batch: batch.length,
        rendered: rendered.length,
        remaining: remainingToRender.length,
      });
    }
  }

  if (toUpload.length === 0) {
    console.warn("[supplementPdfPageFigures] no pages rendered", {
      jobId: input.jobId,
      pdfRefs: pdfRefs.length,
      skipReasons,
      hadPrimaryBuffer: Boolean(input.primaryPdfBuffer),
      storagePath: input.primaryStoragePath?.slice(0, 80),
    });
    return {
      images: filterCroppedFiguresOnly(input.existingImages),
      pageTableExtractions: [],
      renderedPageBuffers: [],
      primaryPdfBuffer,
      primaryFileName,
      pageArtifacts: { tables: {}, figures: [] },
    };
  }

  if (!primaryPdfBuffer) {
    throw new Error(
      `[supplementPdfPageFigures] missing primary PDF buffer job=${input.jobId}`
    );
  }

  const allTargetPages = [
    ...new Set(
      toUpload.map((r) => (r.anchorType === "page" ? r.anchorIndex : 0)).filter((p) => p > 0)
    ),
  ].sort((a, b) => a - b);

  const cropFirst = await runCropFirstExtract({
    admin: input.admin,
    userId: input.userId,
    jobId: input.jobId,
    pdfBuffer: primaryPdfBuffer,
    fileName: primaryFileName,
    renderedPages: toUpload,
    targetPageNumbers: allTargetPages,
    persistToDb: true,
  });

  const pageTableExtractions = cropFirst.pageTableExtractions;

  const images = [
    ...filterCroppedFiguresOnly(input.existingImages),
    ...cropFirst.sourceImages,
  ];

  console.info("[supplementPdfPageFigures] crop-first complete", {
    jobId: input.jobId,
    pagesRendered: toUpload.length,
    tables: pageTableExtractions.length,
    cropsUploaded: cropFirst.cropsUploaded,
    pageSnapshots: cropFirst.pageSnapshots,
    captionsCreated: cropFirst.captionsCreated,
    figureArtifacts: cropFirst.pageArtifacts.figures.length,
  });

  return {
    images,
    pageTableExtractions,
    renderedPageBuffers: toUpload,
    primaryPdfBuffer,
    primaryFileName,
    pageArtifacts: cropFirst.pageArtifacts,
  };
}
