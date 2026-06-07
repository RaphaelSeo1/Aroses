import type { SupabaseClient } from "@supabase/supabase-js";
import { embedText } from "@/lib/embeddings/text-similarity";
import { captionVisualAsset } from "@/lib/pdf-ingest/vision-caption";
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

async function captionCrop(
  crop: RawSourceImage,
  isSnapshot: boolean
): Promise<RawSourceImage> {
  if (!isVisionEnabled()) return crop;
  try {
    const vision = await captionVisualAsset({
      imagePng: crop.buffer,
      pageNum: crop.anchorIndex,
      source: isSnapshot ? "page_snapshot" : "vision_bbox",
      isPageSnapshot: isSnapshot,
    });
    const label =
      vision.title ||
      vision.caption ||
      (isSnapshot
        ? `Snapshot (page ${crop.anchorIndex})`
        : crop.label);
    return {
      ...crop,
      label: isSnapshot ? `Snapshot (page ${crop.anchorIndex}): ${label}` : label,
    };
  } catch {
    return crop;
  }
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
  if (targetPageNumbers.length > 0) {
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
      skipPageNumbers: pagesWithStructural,
    });
    visionCrops = filterRawCropsOnly(vision.cropImages);
    pageTableExtractions = vision.pageTableExtractions;
  }

  const pagesWithCrops = new Set<number>();
  for (const c of [...structuralRaw, ...visionCrops]) {
    if (c.anchorType === "page" && c.anchorIndex > 0) {
      pagesWithCrops.add(c.anchorIndex);
    }
  }

  const snapshots: RawSourceImage[] = [];
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

  let toUpload: RawSourceImage[] = [
    ...filterRawCropsOnly(structuralRaw),
    ...visionCrops,
    ...snapshots,
  ];

  let captionsCreated = 0;
  toUpload = await Promise.all(
    toUpload.map(async (crop) => {
      const isSnapshot = crop.fileName.includes("snapshot");
      const captioned = await captionCrop(crop, isSnapshot);
      if (captioned.label !== crop.label) captionsCreated++;
      return captioned;
    })
  );

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

    for (const t of pageTableExtractions) {
      const caption =
        t.markdown.split("\n")[0]?.slice(0, 160) || `Table page ${t.pageNum}`;
      rows.push({
        job_id: jobId,
        type: "table",
        source: "table_markdown",
        source_page: t.pageNum,
        asset_url: null,
        markdown: t.markdown,
        caption,
        title: caption,
        caption_embedding: await embedText(
          `${caption}\n${t.markdown.slice(0, 400)}`
        ),
      });
    }

    for (const fig of pageFigures) {
      const isSnapshot = fig.caption.toLowerCase().includes("snapshot");
      rows.push({
        job_id: jobId,
        type: fig.kind === "table" ? "table" : isSnapshot ? "image" : "figure",
        source: isSnapshot ? "page_snapshot" : "vision_bbox",
        source_page: fig.pageNum,
        asset_url: fig.url,
        markdown: null,
        caption: fig.caption,
        title: fig.caption.slice(0, 80),
        caption_embedding: await embedText(fig.caption),
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
