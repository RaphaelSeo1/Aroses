import type { SupabaseClient } from "@supabase/supabase-js";
import { embedText, embedTextsBatch } from "@/lib/embeddings/text-similarity";
import { classifyAssetCrop } from "@/lib/pdf-ingest/classify-asset-crop";
import {
  shouldKeepCroppedFigure,
  shouldKeepFigureCaption,
} from "@/lib/pdf-ingest/filter-crop-quality";
import {
  deleteCourseAssetsForJob,
  insertCourseAssets,
  type CourseAssetInsert,
} from "@/lib/pdf-ingest/persist-course-assets";
import { extractPdfSourceImagesForPages } from "@/lib/study-ingest/source-images/extract-pdf";
import {
  extractPageArtifactsFromRenderedPdfPages,
  pageTableExtractionsToMap,
  type PageTableExtraction,
} from "@/lib/study-ingest/source-images/extract-pdf-page-tables";
import {
  filterRawCropsOnly,
} from "@/lib/study-ingest/source-images/is-page-render";
import type { RawSourceImage } from "@/lib/study-ingest/source-images/types";
import { uploadIngestSourceImages } from "@/lib/study-ingest/source-images/upload";
import {
  pageFiguresFromSourceImages,
  serializeIngestPageArtifacts,
  type IngestPageArtifacts,
} from "@/lib/study-ingest/inject-pdf-tables-into-module";
import type { IngestSourceImageRecord } from "@/lib/study-ingest/source-images/types";

export type CropFirstExtractResult = {
  sourceImages: IngestSourceImageRecord[];
  pageArtifacts: IngestPageArtifacts;
  pageTableExtractions: PageTableExtraction[];
  cropsUploaded: number;
  tablesFound: number;
  pagesRendered: number;
  pageSnapshots: number;
  captionsCreated: number;
};

function isVisionEnabled(): boolean {
  const raw = process.env.PDF_INGEST_TABLE_VISION?.trim();
  if (raw === "0" || raw?.toLowerCase() === "false") return false;
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

function isEmbeddedRasterEnabled(): boolean {
  const raw = process.env.PDF_INGEST_EMBEDDED_IMAGES?.trim();
  return raw === "1" || raw?.toLowerCase() === "true";
}

function isPageSnapshotFallbackEnabled(): boolean {
  const raw = process.env.PDF_INGEST_PAGE_SNAPSHOTS?.trim();
  return raw === "1" || raw?.toLowerCase() === "true";
}

/** Second Sonnet pass per crop — slow; off by default (Haiku bbox pass already captions). */
function isDeepVisionEnabled(): boolean {
  const raw = process.env.PDF_INGEST_DEEP_VISION?.trim();
  return raw === "1" || raw?.toLowerCase() === "true";
}

function qualifyConcurrency(): number {
  const raw = process.env.PDF_INGEST_QUALIFY_CONCURRENCY?.trim();
  const n = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 12) : 8;
}

async function qualifyCropForUpload(
  crop: RawSourceImage,
  isSnapshot: boolean
): Promise<RawSourceImage | null> {
  const caption = crop.label ?? "";
  if (
    !(await shouldKeepCroppedFigure({ buffer: crop.buffer, caption }))
  ) {
    return null;
  }
  if (!isVisionEnabled() || !isDeepVisionEnabled()) return crop;

  try {
    const classified = await classifyAssetCrop({
      cropPng: crop.buffer,
      pageNum: crop.anchorIndex,
      source: isSnapshot ? "page_snapshot" : "vision_bbox",
    });
    if (!classified.keep || classified.type === "decorative") return null;
    if (classified.type === "table") return null;
    const label =
      classified.caption ||
      classified.vision?.title ||
      crop.label ||
      `Diagram page ${crop.anchorIndex}`;
    if (!shouldKeepFigureCaption(label)) return null;
    return {
      ...crop,
      label: isSnapshot ? `Snapshot (page ${crop.anchorIndex}): ${label}` : label,
    };
  } catch {
    return crop;
  }
}

async function qualifyCropsForUpload(
  candidates: RawSourceImage[]
): Promise<{ crops: RawSourceImage[]; captionsCreated: number }> {
  const slots: (RawSourceImage | null)[] = new Array(candidates.length);
  let i = 0;
  const workers = Array.from(
    { length: Math.min(qualifyConcurrency(), Math.max(1, candidates.length)) },
    async () => {
      while (i < candidates.length) {
        const idx = i++;
        const crop = candidates[idx]!;
        const isSnapshot = crop.fileName.includes("snapshot");
        slots[idx] = await qualifyCropForUpload(crop, isSnapshot);
      }
    }
  );
  await Promise.all(workers);
  let captionsCreated = 0;
  const crops: RawSourceImage[] = [];
  for (let idx = 0; idx < candidates.length; idx++) {
    const ok = slots[idx];
    if (!ok) continue;
    if (ok.label !== candidates[idx]!.label) captionsCreated++;
    crops.push(ok);
  }
  return { crops, captionsCreated };
}

/**
 * Crop-first PDF visual extraction:
 * render pages → vision bbox crops → page snapshot fallback → caption → upload.
 */
export async function runCropFirstExtract(input: {
  admin: SupabaseClient;
  userId: string;
  jobId: string;
  pdfBuffer: Buffer;
  fileName: string;
  renderedPages: RawSourceImage[];
  targetPageNumbers: number[];
  persistToDb?: boolean;
}): Promise<CropFirstExtractResult> {
  const {
    admin,
    userId,
    jobId,
    pdfBuffer,
    fileName,
    renderedPages,
    targetPageNumbers,
    persistToDb = true,
  } = input;

  const pagesRendered = renderedPages.filter(
    (r) => r.anchorType === "page" && r.anchorIndex > 0
  ).length;

  const empty: CropFirstExtractResult = {
    sourceImages: [],
    pageArtifacts: { tables: {}, figures: [] },
    pageTableExtractions: [],
    cropsUploaded: 0,
    tablesFound: 0,
    pagesRendered,
    pageSnapshots: 0,
    captionsCreated: 0,
  };

  if (renderedPages.length === 0) return empty;

  const pagesWithStructural = new Set<number>();
  const structuralRaw: RawSourceImage[] = [];
  if (isEmbeddedRasterEnabled() && targetPageNumbers.length > 0) {
    const embedded = await extractPdfSourceImagesForPages(
      pdfBuffer,
      fileName,
      targetPageNumbers
    );
    for (const img of embedded) {
      structuralRaw.push(img);
      pagesWithStructural.add(img.anchorIndex);
    }
  }

  let visionCrops: RawSourceImage[] = [];
  let pageTableExtractions: PageTableExtraction[] = [];

  if (isVisionEnabled()) {
    const vision = await extractPageArtifactsFromRenderedPdfPages(renderedPages, {
      jobId,
    });
    visionCrops = filterRawCropsOnly(vision.cropImages);
    pageTableExtractions = vision.pageTableExtractions;
  }

  const pagesWithVisionCrops = new Set(
    visionCrops
      .filter((c) => c.anchorType === "page" && c.anchorIndex > 0)
      .map((c) => c.anchorIndex)
  );
  const pagesNeedingFallback = targetPageNumbers.filter(
    (p) => !pagesWithStructural.has(p) && !pagesWithVisionCrops.has(p)
  );
  if (pagesNeedingFallback.length > 0) {
    const embeddedFallback = await extractPdfSourceImagesForPages(
      pdfBuffer,
      fileName,
      pagesNeedingFallback
    );
    for (const img of embeddedFallback) {
      structuralRaw.push(img);
      pagesWithStructural.add(img.anchorIndex);
    }
    if (embeddedFallback.length > 0) {
      console.info("[crop-first] embedded raster fallback", {
        jobId,
        pages: pagesNeedingFallback,
        images: embeddedFallback.length,
      });
    }
  }

  const pagesWithCrops = new Set<number>();
  for (const c of [...structuralRaw, ...visionCrops]) {
    if (c.anchorType === "page" && c.anchorIndex > 0) {
      pagesWithCrops.add(c.anchorIndex);
    }
  }

  const snapshots: RawSourceImage[] = [];
  if (isPageSnapshotFallbackEnabled()) {
    for (const render of renderedPages) {
      if (render.anchorType !== "page" || render.anchorIndex <= 0) continue;
      if (pagesWithCrops.has(render.anchorIndex)) continue;
      snapshots.push({
        buffer: render.buffer,
        mimeType: "image/png",
        fileName: `page-${render.anchorIndex}-snapshot.png`,
        sourceFileName: fileName,
        label: `Snapshot (page ${render.anchorIndex})`,
        anchorType: "page",
        anchorIndex: render.anchorIndex,
      });
    }
  }

  const candidates: RawSourceImage[] = [
    ...filterRawCropsOnly(structuralRaw),
    ...visionCrops,
    ...snapshots,
  ];

  const { crops: toUpload, captionsCreated } =
    await qualifyCropsForUpload(candidates);

  console.info("[crop-first] visual extract", {
    jobId,
    pagesRendered,
    visionEnabled: isVisionEnabled(),
    structuralCrops: structuralRaw.length,
    visionCrops: visionCrops.length,
    pageSnapshots: snapshots.length,
    captionsCreated,
    tableTextChunks: pageTableExtractions.length,
    uploading: toUpload.length,
  });

  let uploaded: IngestSourceImageRecord[] = [];
  if (toUpload.length > 0) {
    uploaded = await uploadIngestSourceImages({
      admin,
      userId,
      jobId,
      images: toUpload,
    });
    if (uploaded.length === 0) {
      throw new Error(
        `[crop-first] upload failed job=${jobId} — check study-material-images bucket`
      );
    }
  }

  const tableMap = pageTableExtractionsToMap(pageTableExtractions);
  const pageFigures = pageFiguresFromSourceImages(uploaded);
  const pageArtifacts = serializeIngestPageArtifacts({
    tables: tableMap,
    figures: pageFigures,
  });

  if (persistToDb && uploaded.length > 0) {
    await deleteCourseAssetsForJob(admin, jobId);
    const rows: CourseAssetInsert[] = [];

    const tableRows = pageTableExtractions.map((t) => {
      const caption =
        t.markdown.split("\n")[0]?.slice(0, 160) || `Table page ${t.pageNum}`;
      return {
        job_id: jobId,
        type: "table" as const,
        source: "table_markdown" as const,
        source_page: t.pageNum,
        asset_url: null,
        markdown: t.markdown,
        caption,
        title: caption,
        embedInput: `${caption}\n${t.markdown.slice(0, 400)}`,
      };
    });

    const figureRows = pageFigures.flatMap((fig) => {
      if (fig.kind === "table") return [];
      if (!shouldKeepFigureCaption(fig.caption)) return [];
      const isSnapshot = fig.caption.toLowerCase().includes("snapshot");
      return [
        {
          job_id: jobId,
          type: (isSnapshot ? "image" : "figure") as "image" | "figure",
          source: (isSnapshot ? "page_snapshot" : "vision_bbox") as
            | "page_snapshot"
            | "vision_bbox",
          source_page: fig.pageNum,
          asset_url: fig.url,
          markdown: null,
          caption: fig.caption,
          title: fig.caption.slice(0, 80),
          embedInput: fig.caption,
        },
      ];
    });

    const embedInputs = [...tableRows, ...figureRows].map((r) => r.embedInput);
    const embeddings = await embedTextsBatch(embedInputs, 10);

    let embIdx = 0;
    for (const t of tableRows) {
      rows.push({
        job_id: t.job_id,
        type: t.type,
        source: t.source,
        source_page: t.source_page,
        asset_url: t.asset_url,
        markdown: t.markdown,
        caption: t.caption,
        title: t.title,
        caption_embedding: embeddings[embIdx++] ?? (await embedText(t.embedInput)),
      });
    }
    for (const f of figureRows) {
      rows.push({
        job_id: f.job_id,
        type: f.type,
        source: f.source,
        source_page: f.source_page,
        asset_url: f.asset_url,
        markdown: f.markdown,
        caption: f.caption,
        title: f.title,
        caption_embedding: embeddings[embIdx++] ?? (await embedText(f.embedInput)),
      });
    }

    if (rows.length > 0) {
      const inserted = await insertCourseAssets(admin, rows);
      console.info("[crop-first] course_assets persisted", {
        jobId,
        inserted,
        rows: rows.length,
        withUrl: rows.filter((r) => r.asset_url).length,
      });
    }
  }

  console.info("[crop-first] pipeline complete", {
    jobId,
    pagesRendered,
    visualAssetsCreated: uploaded.length,
    captionsCreated,
    figureArtifacts: pageFigures.length,
    pageSnapshots: snapshots.length,
  });

  return {
    sourceImages: uploaded,
    pageArtifacts,
    pageTableExtractions,
    cropsUploaded: uploaded.length,
    tablesFound: pageTableExtractions.length,
    pagesRendered,
    pageSnapshots: snapshots.length,
    captionsCreated,
  };
}
