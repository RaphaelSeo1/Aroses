import type { SupabaseClient } from "@supabase/supabase-js";
import type { CourseStructurePlan } from "@/lib/ai/course-payload";
import type { PersistedIngestChunk } from "@/lib/source-attribution";
import type { IngestSourceFileRef } from "@/lib/study-ingest/job-extract";
import {
  getPdfPageCount,
  renderPdfPagesToPng,
} from "@/lib/study-ingest/source-images/render-pdf-page";
import type { IngestSourceImageRecord } from "@/lib/study-ingest/source-images/types";
import { uploadIngestSourceImages } from "@/lib/study-ingest/source-images/upload";
import { STUDY_PDF_INGEST_BUCKET } from "@/lib/study-pdf-ingest";

const MAX_PAGES_RENDERED_PER_PDF = 15;
const MAX_PAGES_RENDERED_PER_JOB = 20;

function filesMatch(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function parseSectionNumber(position: string): number | null {
  const m = position.match(/\bsection\s+(\d+)\b/i);
  if (!m) return null;
  const n = Number.parseInt(m[1]!, 10);
  return Number.isFinite(n) ? n : null;
}

function parsePageNumber(position: string): number | null {
  const m = position.match(/\bpage\s+~?(\d+)\b/i);
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
    const directPage = parsePageNumber(chunk.position);
    if (directPage !== null) {
      pages.add(Math.min(pageCount, Math.max(1, directPage)));
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
}): Promise<IngestSourceImageRecord[]> {
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
  if (pdfRefs.length === 0) return input.existingImages;

  const toUpload: Awaited<ReturnType<typeof renderPdfPagesToPng>> = [];
  let renderedCount = 0;
  const remainingBudget = MAX_PAGES_RENDERED_PER_JOB;
  if (remainingBudget <= 0) return input.existingImages;

  for (const ref of pdfRefs) {
    if (renderedCount >= remainingBudget) break;

    const fileName =
      typeof ref.originalFileName === "string" && ref.originalFileName.trim()
        ? ref.originalFileName.trim()
        : "upload.pdf";

    const buffer = await downloadPdfBuffer(input.admin, ref.storagePath);
    if (!buffer) continue;

    const pageCount = await getPdfPageCount(buffer);
    if (pageCount <= 0) continue;

    const targetPages = targetPdfPagesForFile({
      fileName,
      pageCount,
      chunks: input.chunks,
      plan: input.plan,
    });
    if (targetPages.length === 0) continue;

    const covered = pagesWithEmbeddedImages(input.existingImages, fileName);
    const missing = targetPages.filter((p) => !covered.has(p));
    if (missing.length === 0) continue;

    const cap = Math.min(
      MAX_PAGES_RENDERED_PER_PDF,
      remainingBudget - renderedCount
    );
    const toRender = missing.slice(0, cap);
    if (toRender.length === 0) continue;

    const rendered = await renderPdfPagesToPng(buffer, toRender, fileName);
    toUpload.push(...rendered);
    renderedCount += rendered.length;

    console.info("[supplementPdfPageFigures]", {
      jobId: input.jobId,
      fileName,
      requested: toRender.length,
      rendered: rendered.length,
    });
  }

  if (toUpload.length === 0) return input.existingImages;

  const uploaded = await uploadIngestSourceImages({
    admin: input.admin,
    userId: input.userId,
    jobId: input.jobId,
    images: toUpload,
  });

  if (uploaded.length === 0) return input.existingImages;
  return [...input.existingImages, ...uploaded];
}
