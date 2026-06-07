import type { SupabaseClient } from "@supabase/supabase-js";
import { embedText } from "@/lib/embeddings/text-similarity";
import { classifyAssetCrop } from "@/lib/pdf-ingest/classify-asset-crop";
import {
  buildSearchableCaptionText,
  captionVisualAsset,
} from "@/lib/pdf-ingest/vision-caption";
import {
  extractStructuralCandidatesForPage,
  structuralCropsEnabled,
  TABLE_VECTOR_IOU_DEDUP,
  type StructuralCandidate,
} from "@/lib/pdf-ingest/extract-assets";
import { iouPixel, type PixelRect } from "@/lib/pdf-ingest/bbox-math";
import { openCheckPublicUrl } from "@/lib/pdf-ingest/open-check-url";
import {
  deleteCourseAssetsForJob,
  insertCourseAssets,
  type CourseAssetInsert,
  type CourseAssetSource,
  type CourseAssetType,
} from "@/lib/pdf-ingest/persist-course-assets";
import {
  logClassifyCounts,
  logExtractCounts,
  type PdfAssetClassifyCounts,
  type PdfAssetExtractCounts,
} from "@/lib/pdf-ingest/stage-counts";
import {
  cropPngToFigure,
  parseNormalizedBbox,
} from "@/lib/study-ingest/source-images/crop-page-figure";
import {
  extractFigureBboxesFromPdfPagePng,
  extractTablesFromPdfPagePng,
} from "@/lib/study-ingest/source-images/extract-pdf-page-tables";
import {
  pageFiguresFromSourceImages,
  serializeIngestPageArtifacts,
  type IngestPageArtifacts,
} from "@/lib/study-ingest/inject-pdf-tables-into-module";
import { pageTableExtractionsToMap } from "@/lib/study-ingest/source-images/extract-pdf-page-tables";
import { loadPdfDocument } from "@/lib/study-ingest/source-images/render-pdf-page";
import { pageTableKey } from "@/lib/study-ingest/source-images/page-table-keys";
import type {
  IngestSourceImageRecord,
  RawSourceImage,
} from "@/lib/study-ingest/source-images/types";

const MAX_RENDER_WIDTH_PX = 1_400;
const DEFAULT_SCALE = 1.75;
const BUCKET = "study-material-images";

function captionFromTableMarkdown(markdown: string, pageNum: number): string {
  const header = markdown
    .split("\n")
    .find((l) => l.includes("|") && !l.includes("---"));
  if (header) {
    const cells = header
      .split("|")
      .map((c) => c.trim())
      .filter(Boolean);
    if (cells.length > 0) {
      return `Table (page ${pageNum}): ${cells.slice(0, 4).join(", ")}`.slice(
        0,
        200
      );
    }
  }
  return `Table from page ${pageNum}`;
}

function mapClassifyType(type: string): CourseAssetType {
  if (type === "table") return "table";
  if (type === "image") return "image";
  return "figure";
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from(
    { length: Math.min(limit, Math.max(1, items.length)) },
    async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]!);
      }
    }
  );
  await Promise.all(workers);
  return out;
}

type PendingCrop = {
  type: CourseAssetType;
  source: CourseAssetSource;
  source_page: number;
  cropBuffer: Buffer;
  caption: string;
  bbox: PixelRect | null;
  keep: boolean;
  discardReason?: string;
  title?: string;
  description?: string;
  labels?: string[];
  relatedTopics?: string[];
  teachingPurpose?: string;
  whenToUse?: string;
  surroundingText?: string;
};

type PendingTable = {
  type: "table";
  source: "table_markdown";
  source_page: number;
  markdown: string;
  caption: string;
  keep: true;
};

export type PdfAssetPipelineResult = {
  extractCounts: PdfAssetExtractCounts;
  classifyCounts: PdfAssetClassifyCounts;
  courseAssetRows: CourseAssetInsert[];
  inserted: number;
  sourceImages: IngestSourceImageRecord[];
  pageArtifacts: IngestPageArtifacts;
};

async function uploadCropStrict(input: {
  admin: SupabaseClient;
  userId: string;
  jobId: string;
  crop: RawSourceImage;
  index: number;
}): Promise<IngestSourceImageRecord> {
  const { admin, userId, jobId, crop, index } = input;
  const path = `${userId}/ingest/${jobId}/pipeline-${index + 1}-${crypto.randomUUID()}.png`;

  const { error } = await admin.storage.from(BUCKET).upload(path, crop.buffer, {
    contentType: crop.mimeType,
    upsert: false,
  });
  if (error) {
    throw new Error(
      `[pdf-asset-pipeline] upload failed page=${crop.anchorIndex} path=${path}: ${error.message}`
    );
  }

  const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path);
  const url = pub?.publicUrl?.trim();
  if (!url) {
    throw new Error(
      `[pdf-asset-pipeline] upload returned no public URL page=${crop.anchorIndex} path=${path}`
    );
  }

  console.info(
    `[pdf-asset-pipeline] UPLOAD page=${crop.anchorIndex} label="${crop.label}" url=${url}`
  );
  await openCheckPublicUrl(url, `page-${crop.anchorIndex}-${crop.label}`);

  return {
    id: `${jobId}-pipeline-${index + 1}`,
    url,
    sourceFileName: crop.sourceFileName,
    label: crop.label,
    anchorType: crop.anchorType,
    anchorIndex: crop.anchorIndex,
    mimeType: crop.mimeType,
  };
}

/**
 * One-pass EXTRACT → CLASSIFY → upload for rendered PDF pages.
 * Throws loudly on zero renders or upload/open-check failures.
 */
export async function runPdfAssetPipeline(input: {
  admin?: SupabaseClient | null;
  userId?: string;
  jobId: string;
  pdfBuffer: Buffer;
  fileName: string;
  renderedPages: RawSourceImage[];
  persistToDb?: boolean;
  /** When true, skip Supabase upload/DB — for local diagnostics only. */
  localOnly?: boolean;
}): Promise<PdfAssetPipelineResult> {
  const {
    admin,
    userId,
    jobId,
    pdfBuffer,
    fileName,
    renderedPages,
    persistToDb = true,
    localOnly = false,
  } = input;

  const extractCounts: PdfAssetExtractCounts = {
    pagesRendered: renderedPages.filter(
      (r) => r.anchorType === "page" && r.anchorIndex > 0
    ).length,
    rasterImages: 0,
    vectorDiagrams: 0,
    tablesFound: 0,
    cropsUploaded: 0,
  };

  if (extractCounts.pagesRendered === 0) {
    throw new Error(
      `[pdf-asset-pipeline] EXTRACT pagesRendered=0 — PDF page render is off or broken. Check PDF_INGEST_PAGE_RENDER, @napi-rs/canvas, and pdf.js.`
    );
  }

  if (persistToDb && admin && !localOnly) {
    await deleteCourseAssetsForJob(admin, jobId);
  }

  const { pdf } = await loadPdfDocument(pdfBuffer);
  const seenImageIds = new Set<string>();
  const cropPending: PendingCrop[] = [];
  const tableRows: PendingTable[] = [];
  const tableLikeByPage = new Map<number, PixelRect[]>();
  const pagesWithMarkdownTable = new Set<number>();

  const classifyConcurrency = Math.min(
    6,
    Math.max(
      1,
      Number.parseInt(process.env.PDF_INGEST_ASSET_CLASSIFY_CONCURRENCY ?? "4", 10) ||
        4
    )
  );

  try {
    for (const render of renderedPages) {
      if (render.anchorType !== "page" || render.anchorIndex <= 0) continue;
      const pageNum = render.anchorIndex;
      const pagePng = render.buffer;

      const tableMd = await extractTablesFromPdfPagePng({
        buffer: pagePng,
        pageNum,
        sourceFileName: fileName,
      });
      if (tableMd) {
        extractCounts.tablesFound++;
        pagesWithMarkdownTable.add(pageNum);
        tableRows.push({
          type: "table",
          source: "table_markdown",
          source_page: pageNum,
          markdown: tableMd,
          caption: captionFromTableMarkdown(tableMd, pageNum),
          keep: true,
        });
      }

      const page = await pdf.getPage(pageNum);
      try {
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(
          DEFAULT_SCALE,
          base.width > 0 ? MAX_RENDER_WIDTH_PX / base.width : DEFAULT_SCALE
        );
        const viewport = page.getViewport({ scale }) as {
          width: number;
          height: number;
          convertToViewportPoint: (x: number, y: number) => number[];
        };

        let structuralRaster: StructuralCandidate[] = [];
        let structuralVector: StructuralCandidate[] = [];

        if (structuralCropsEnabled()) {
          const structural = await extractStructuralCandidatesForPage({
            page,
            viewport,
            pagePng,
            pageNum,
            seenImageObjectIds: seenImageIds,
          });
          structuralRaster = structural.raster;
          structuralVector = structural.vector;
          extractCounts.rasterImages += structuralRaster.length;
          extractCounts.vectorDiagrams += structuralVector.length;
          if (structural.tableLikeRegions.length > 0) {
            tableLikeByPage.set(pageNum, structural.tableLikeRegions);
          }
        }

        const structuralAll = [...structuralRaster, ...structuralVector];

        if (structuralAll.length === 0) {
          const hits = await extractFigureBboxesFromPdfPagePng({
            buffer: pagePng,
            pageNum,
            sourceFileName: fileName,
          });
          for (const hit of hits) {
            const bbox = parseNormalizedBbox(hit.bbox);
            if (!bbox) continue;
            const cropped = await cropPngToFigure(pagePng, bbox);
            if (!cropped) continue;
            cropPending.push({
              type: "figure",
              source: "vision_bbox",
              source_page: pageNum,
              cropBuffer: cropped,
              caption: hit.caption,
              bbox: null,
              keep: true,
            });
          }
        } else {
          for (const c of structuralAll) {
            cropPending.push({
              type: "figure",
              source: c.source,
              source_page: pageNum,
              cropBuffer: c.cropBuffer,
              caption: "",
              bbox: c.pixelRect,
              keep: true,
            });
          }
        }
      } finally {
        page.cleanup();
      }
    }
  } finally {
    await pdf.destroy().catch(() => {});
  }

  logExtractCounts(jobId, extractCounts);

  const classified = await mapWithConcurrency(
    cropPending,
    classifyConcurrency,
    async (p) => {
      const result = await classifyAssetCrop({
        cropPng: p.cropBuffer,
        pageNum: p.source_page,
        source: p.source,
      });
      return { pending: p, result };
    }
  );

  const classifyCounts: PdfAssetClassifyCounts = {
    kept: tableRows.length,
    discarded: 0,
  };

  for (const { pending: p, result } of classified) {
    p.type = mapClassifyType(result.type);
    p.caption = result.caption || p.caption;
    p.keep = result.keep;
    if (result.vision) {
      p.title = result.vision.title;
      p.description = result.vision.description;
      p.labels = result.vision.labels;
      p.relatedTopics = result.vision.relatedTopics;
      p.teachingPurpose = result.vision.teachingPurpose;
      p.whenToUse = result.vision.whenToUse;
    }

    if (!result.keep || result.type === "decorative") {
      classifyCounts.discarded++;
      p.discardReason = result.type === "decorative" ? "decorative" : "keep=false";
      console.info(
        `[pdf-asset-pipeline] CLASSIFY discard page=${p.source_page} source=${p.source} reason=${p.discardReason} caption="${result.caption}"`
      );
      continue;
    }

    if (
      p.source === "structural_vector" &&
      pagesWithMarkdownTable.has(p.source_page) &&
      p.type === "table" &&
      p.bbox
    ) {
      const tableRegions = tableLikeByPage.get(p.source_page) ?? [];
      const overlaps = tableRegions.some(
        (t) => iouPixel(p.bbox!, t) >= TABLE_VECTOR_IOU_DEDUP
      );
      if (overlaps) {
        classifyCounts.discarded++;
        p.keep = false;
        p.discardReason = "vector-table-dedup-with-markdown";
        console.info(
          `[pdf-asset-pipeline] CLASSIFY discard page=${p.source_page} source=${p.source} reason=${p.discardReason}`
        );
        continue;
      }
    }

    if (
      p.source === "structural_vector" &&
      pagesWithMarkdownTable.has(p.source_page) &&
      p.type === "table" &&
      !p.bbox
    ) {
      classifyCounts.discarded++;
      p.keep = false;
      p.discardReason = "vector-table-without-bbox-on-markdown-page";
      console.info(
        `[pdf-asset-pipeline] CLASSIFY discard page=${p.source_page} source=${p.source} reason=${p.discardReason}`
      );
      continue;
    }

    classifyCounts.kept++;
    console.info(
      `[pdf-asset-pipeline] CLASSIFY keep page=${p.source_page} type=${p.type} source=${p.source} caption="${p.caption}"`
    );
  }

  logClassifyCounts(jobId, classifyCounts);

  const keptCrops = cropPending.filter((p) => p.keep);
  const pagesWithKeptVisuals = new Set(keptCrops.map((p) => p.source_page));

  // Fallback: full-page snapshot when extraction found nothing on a rendered page.
  const snapshotPending: PendingCrop[] = [];
  for (const render of renderedPages) {
    if (render.anchorType !== "page" || render.anchorIndex <= 0) continue;
    const pageNum = render.anchorIndex;
    if (pagesWithKeptVisuals.has(pageNum)) continue;
    snapshotPending.push({
      type: "image",
      source: "page_snapshot",
      source_page: pageNum,
      cropBuffer: render.buffer,
      caption: `Page ${pageNum} snapshot`,
      bbox: null,
      keep: true,
    });
  }

  if (snapshotPending.length > 0) {
    console.info(
      `[pdf-asset-pipeline] PAGE_SNAPSHOT fallback for ${snapshotPending.length} page(s)`
    );
    const snapClassified = await mapWithConcurrency(
      snapshotPending,
      classifyConcurrency,
      async (p) => {
        const vision = await captionVisualAsset({
          imagePng: p.cropBuffer,
          pageNum: p.source_page,
          source: p.source,
          isPageSnapshot: true,
        });
        return { pending: p, vision };
      }
    );
    for (const { pending: p, vision } of snapClassified) {
      if (!vision.keep) {
        p.keep = false;
        continue;
      }
      p.caption = vision.caption || vision.title;
      p.title = vision.title;
      p.description = vision.description;
      p.labels = vision.labels;
      p.relatedTopics = vision.relatedTopics;
      p.teachingPurpose = vision.teachingPurpose;
      p.whenToUse = vision.whenToUse;
      keptCrops.push(p);
      pagesWithKeptVisuals.add(p.source_page);
    }
  }

  const uploadInputs: RawSourceImage[] = keptCrops.map((p, i) => ({
    buffer: p.cropBuffer,
    mimeType: "image/png" as const,
    fileName: `asset-p${p.source_page}-${i + 1}.png`,
    sourceFileName: fileName,
    label: p.caption || `Asset page ${p.source_page}`,
    anchorType: "page" as const,
    anchorIndex: p.source_page,
  }));

  const uploaded: IngestSourceImageRecord[] = [];
  if (localOnly) {
    for (let i = 0; i < uploadInputs.length; i++) {
      const crop = uploadInputs[i]!;
      const url = `https://local.test/ingest/${jobId}/p${crop.anchorIndex}-${i + 1}.png`;
      console.info(
        `[pdf-asset-pipeline] UPLOAD (local) page=${crop.anchorIndex} label="${crop.label}" url=${url}`
      );
      uploaded.push({
        id: `${jobId}-local-${i + 1}`,
        url,
        sourceFileName: crop.sourceFileName,
        label: crop.label,
        anchorType: crop.anchorType,
        anchorIndex: crop.anchorIndex,
        mimeType: crop.mimeType,
      });
      extractCounts.cropsUploaded++;
    }
  } else {
    if (!admin || !userId) {
      throw new Error(
        "[pdf-asset-pipeline] admin and userId required for upload (set localOnly=true for diagnostics)"
      );
    }
    for (let i = 0; i < uploadInputs.length; i++) {
      const rec = await uploadCropStrict({
        admin,
        userId,
        jobId,
        crop: uploadInputs[i]!,
        index: i,
      });
      uploaded.push(rec);
      extractCounts.cropsUploaded++;
    }
  }

  logExtractCounts(jobId, extractCounts);

  let uploadIdx = 0;
  const courseAssetRows: CourseAssetInsert[] = [];

  for (const t of tableRows) {
    const searchable = `${t.caption}\n${t.markdown.slice(0, 500)}`;
    const embedding = await embedText(searchable);
    courseAssetRows.push({
      job_id: jobId,
      type: "table",
      source: t.source,
      source_page: t.source_page,
      asset_url: null,
      markdown: t.markdown,
      caption: t.caption,
      caption_embedding: embedding,
      bbox: null,
      title: t.caption,
      description: t.markdown.slice(0, 600),
    });
  }

  for (const p of keptCrops) {
    const assetUrl = uploaded[uploadIdx]?.url ?? null;
    if (p.cropBuffer) uploadIdx++;

    const caption = p.caption || `Visual from page ${p.source_page}`;
    const searchable = buildSearchableCaptionText({
      type: p.source === "page_snapshot" ? "page_snapshot" : "figure",
      title: p.title ?? caption,
      description: p.description ?? "",
      caption,
      labels: p.labels ?? [],
      teachingPurpose: p.teachingPurpose ?? "",
      relatedTopics: p.relatedTopics ?? [],
      whenToUse: p.whenToUse ?? "",
      keep: true,
    });
    const embedding = await embedText(searchable || caption);

    courseAssetRows.push({
      job_id: jobId,
      type: p.type,
      source: p.source,
      source_page: p.source_page,
      asset_url: assetUrl,
      markdown: null,
      caption,
      caption_embedding: embedding,
      bbox: p.bbox,
      title: p.title ?? null,
      description: p.description ?? null,
      labels_json: p.labels ?? [],
      related_topics_json: p.relatedTopics ?? [],
      teaching_purpose: p.teachingPurpose ?? null,
      when_to_use: p.whenToUse ?? null,
      surrounding_text: p.surroundingText ?? null,
    });
  }

  let inserted = 0;
  if (persistToDb && !localOnly && courseAssetRows.length > 0) {
    if (!admin) {
      throw new Error("[pdf-asset-pipeline] admin required for persistToDb");
    }
    inserted = await insertCourseAssets(admin, courseAssetRows);
    if (inserted === 0 && courseAssetRows.length > 0) {
      console.error(
        "[pdf-asset-pipeline] insertCourseAssets returned 0 — apply migration 073_course_assets.sql; assets still flow via ingest_asset_manifest"
      );
    }
  }

  const tableMap = pageTableExtractionsToMap(
    tableRows.map((t) => ({
      key: pageTableKey(fileName, t.source_page),
      sourceFileName: fileName,
      pageNum: t.source_page,
      markdown: t.markdown,
    }))
  );
  const pageFigures = pageFiguresFromSourceImages(uploaded);
  const pageArtifacts = serializeIngestPageArtifacts({
    tables: tableMap,
    figures: pageFigures,
  });

  console.info("[pdf-asset-pipeline] pipeline complete", {
    jobId,
    inserted,
    courseAssetRows: courseAssetRows.length,
    sourceImages: uploaded.length,
    tablePages: tableMap.size,
    figurePages: pageFigures.length,
  });

  return {
    extractCounts,
    classifyCounts,
    courseAssetRows,
    inserted,
    sourceImages: uploaded,
    pageArtifacts,
  };
}
