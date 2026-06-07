import type { SupabaseClient } from "@supabase/supabase-js";
import { runPdfAssetPipeline } from "@/lib/pdf-ingest/asset-pipeline";
import type { RawSourceImage } from "@/lib/study-ingest/source-images/types";

export type EnrichCourseAssetsResult = {
  inserted: number;
  tables: number;
  figures: number;
  skippedDecorative: number;
};

/**
 * Extract + classify PDF visuals into `course_assets` (delegates to unified pipeline).
 */
export async function enrichCourseAssets(input: {
  admin: SupabaseClient;
  userId: string;
  jobId: string;
  pdfBuffer: Buffer;
  fileName: string;
  renderedPages: RawSourceImage[];
}): Promise<EnrichCourseAssetsResult> {
  const result = await runPdfAssetPipeline({
    admin: input.admin,
    userId: input.userId,
    jobId: input.jobId,
    pdfBuffer: input.pdfBuffer,
    fileName: input.fileName,
    renderedPages: input.renderedPages,
    persistToDb: true,
  });

  const tables = result.courseAssetRows.filter((r) => r.type === "table").length;
  const figures = result.courseAssetRows.filter(
    (r) => r.type === "figure" || r.type === "image"
  ).length;

  return {
    inserted: result.inserted,
    tables,
    figures,
    skippedDecorative: result.classifyCounts.discarded,
  };
}
