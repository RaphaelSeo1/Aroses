import type { SupabaseClient } from "@supabase/supabase-js";
import { runCropFirstExtract } from "@/lib/pdf-ingest/crop-first-extract";
import { buildCourseAssetManifest } from "@/lib/study-ingest/course-assets";
import type { CourseAssetManifest } from "@/lib/study-ingest/course-assets";
import type { IngestPageArtifacts } from "@/lib/study-ingest/inject-pdf-tables-into-module";
import type { CourseStructurePlan } from "@/lib/ai/course-payload";
import type { PersistedIngestChunk } from "@/lib/source-attribution";
import {
  getPdfPageCount,
  renderPdfPagesToPng,
} from "@/lib/study-ingest/source-images/render-pdf-page";
import { supplementPdfPageFigures } from "@/lib/study-ingest/source-images/supplement-pdf-pages";
import type { IngestSourceImageRecord } from "@/lib/study-ingest/source-images/types";
import { STUDY_PDF_INGEST_BUCKET } from "@/lib/study-pdf-ingest";

function figuresWithUrls(artifacts: IngestPageArtifacts): number {
  return artifacts.figures.filter((f) => f.url?.trim()).length;
}

async function downloadPdf(
  admin: SupabaseClient,
  storagePath: string
): Promise<Buffer | null> {
  const { data, error } = await admin.storage
    .from(STUDY_PDF_INGEST_BUCKET)
    .download(storagePath);
  if (error || !data) {
    console.warn("[ensurePdfVisuals] download failed", storagePath, error?.message);
    return null;
  }
  return Buffer.from(await data.arrayBuffer());
}

/**
 * Last-chance visual extraction at finalize when outline enrich produced nothing.
 */
export async function ensurePdfVisualsAtFinalize(input: {
  admin: SupabaseClient;
  userId: string;
  jobId: string;
  storagePath: string;
  fileName: string;
  pageArtifacts: IngestPageArtifacts;
  sourceImages: IngestSourceImageRecord[];
  chunks: PersistedIngestChunk[];
  plan: CourseStructurePlan | null;
  knownPageCount?: number;
}): Promise<{
  pageArtifacts: IngestPageArtifacts;
  sourceImages: IngestSourceImageRecord[];
  manifest: CourseAssetManifest | null;
}> {
  if (figuresWithUrls(input.pageArtifacts) > 0) {
    const manifest = await buildCourseAssetManifest(input.pageArtifacts);
    return {
      pageArtifacts: input.pageArtifacts,
      sourceImages: input.sourceImages,
      manifest: manifest.assets.length > 0 ? manifest : null,
    };
  }

  console.warn("[ensurePdfVisuals] no figure URLs — running finalize fallback", {
    jobId: input.jobId,
    storagePath: input.storagePath.slice(0, 80),
    existingFigures: input.pageArtifacts.figures.length,
  });

  let pdfBuffer = await downloadPdf(input.admin, input.storagePath);
  if (!pdfBuffer) {
    return {
      pageArtifacts: input.pageArtifacts,
      sourceImages: input.sourceImages,
      manifest: null,
    };
  }

  let pageCount = await getPdfPageCount(pdfBuffer);
  if (pageCount <= 0 && input.knownPageCount && input.knownPageCount > 0) {
    pageCount = input.knownPageCount;
    console.info("[ensurePdfVisuals] using known page count from text extract", {
      jobId: input.jobId,
      pageCount,
    });
  }
  if (pageCount <= 0) {
    console.warn("[ensurePdfVisuals] page count zero", input.jobId);
    return {
      pageArtifacts: input.pageArtifacts,
      sourceImages: input.sourceImages,
      manifest: null,
    };
  }

  const maxPages = Math.min(pageCount, 120);
  const pageNumbers = Array.from({ length: maxPages }, (_, i) => i + 1);
  const rendered = await renderPdfPagesToPng(
    pdfBuffer,
    pageNumbers,
    input.fileName
  );

  if (rendered.length === 0) {
    console.warn("[ensurePdfVisuals] render returned 0 pages", {
      jobId: input.jobId,
      pageCount,
    });
    return {
      pageArtifacts: input.pageArtifacts,
      sourceImages: input.sourceImages,
      manifest: null,
    };
  }

  const cropFirst = await runCropFirstExtract({
    admin: input.admin,
    userId: input.userId,
    jobId: input.jobId,
    pdfBuffer,
    fileName: input.fileName,
    renderedPages: rendered,
    targetPageNumbers: pageNumbers,
    persistToDb: true,
  });

  if (cropFirst.pageArtifacts.figures.length > 0) {
    const manifest = await buildCourseAssetManifest(cropFirst.pageArtifacts);
    console.info("[ensurePdfVisuals] fallback complete", {
      jobId: input.jobId,
      pagesRendered: cropFirst.pagesRendered,
      visualAssets: cropFirst.cropsUploaded,
      pageSnapshots: cropFirst.pageSnapshots,
      manifestAssets: manifest.assets.length,
    });
    return {
      pageArtifacts: cropFirst.pageArtifacts,
      sourceImages: [...input.sourceImages, ...cropFirst.sourceImages],
      manifest: manifest.assets.length > 0 ? manifest : null,
    };
  }

  // Delegate to full supplement path (handles multi-file + chunk hints).
  const supplemented = await supplementPdfPageFigures({
    admin: input.admin,
    userId: input.userId,
    jobId: input.jobId,
    chunks: input.chunks,
    plan: input.plan,
    existingImages: input.sourceImages,
    sourceFiles: null,
    primaryStoragePath: input.storagePath,
    primaryFileName: input.fileName,
    primaryPdfBuffer: pdfBuffer,
    knownPageCount: input.knownPageCount,
  });

  const manifest = await buildCourseAssetManifest(supplemented.pageArtifacts);
  console.info("[ensurePdfVisuals] supplement fallback complete", {
    jobId: input.jobId,
    figures: supplemented.pageArtifacts.figures.length,
    manifestAssets: manifest.assets.length,
  });

  return {
    pageArtifacts: supplemented.pageArtifacts,
    sourceImages: supplemented.images,
    manifest: manifest.assets.length > 0 ? manifest : null,
  };
}
