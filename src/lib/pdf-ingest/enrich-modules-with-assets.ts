import type { SupabaseClient } from "@supabase/supabase-js";
import { attachVisualAssetsToModules } from "@/lib/study-ingest/lesson-visual-assets";
import { placeAllPdfAssetsIntoModules } from "@/lib/pdf-ingest/place-course-assets";
import {
  loadCourseAssetsForJob,
} from "@/lib/pdf-ingest/persist-course-assets";
import {
  buildCourseAssetManifest,
  mergeManifestWithDbAssets,
  type CourseAssetManifest,
} from "@/lib/study-ingest/course-assets";
import type { IngestPageArtifacts } from "@/lib/study-ingest/inject-pdf-tables-into-module";
import type { CourseModule } from "@/types/course";

/**
 * Inject PDF figures/tables into module lesson bodies for live preview and
 * persisted ingest_modules — not only at finalize.
 */
export async function enrichModulesWithPdfAssets(input: {
  admin: SupabaseClient;
  jobId: string;
  modules: CourseModule[];
  manifest: CourseAssetManifest | null;
  pageArtifacts: IngestPageArtifacts;
  fileName: string;
}): Promise<CourseModule[]> {
  if (input.modules.length === 0) return input.modules;

  let courseAssetsFromDb: Awaited<ReturnType<typeof loadCourseAssetsForJob>> = [];
  try {
    courseAssetsFromDb = await loadCourseAssetsForJob(input.admin, input.jobId);
  } catch (e) {
    console.warn("[enrichModulesWithPdfAssets] loadCourseAssetsForJob", input.jobId, e);
  }

  if (
    courseAssetsFromDb.length === 0 &&
    input.pageArtifacts.figures.filter((f) => f.url?.trim()).length === 0 &&
    (!input.manifest || input.manifest.assets.length === 0)
  ) {
    return input.modules;
  }

  let effectiveManifest = input.manifest;
  if (
    (!effectiveManifest || effectiveManifest.assets.length === 0) &&
    input.pageArtifacts.figures.length > 0
  ) {
    try {
      effectiveManifest = await buildCourseAssetManifest(input.pageArtifacts);
    } catch (e) {
      console.warn("[enrichModulesWithPdfAssets] build manifest", input.jobId, e);
    }
  }

  effectiveManifest = mergeManifestWithDbAssets(
    effectiveManifest,
    courseAssetsFromDb,
    input.fileName
  );

  if (!effectiveManifest || effectiveManifest.assets.length === 0) {
    return input.modules;
  }

  const placed = await placeAllPdfAssetsIntoModules(input.modules, {
    manifest: effectiveManifest,
    pageArtifacts: input.pageArtifacts,
    courseAssets: courseAssetsFromDb,
    jobId: input.jobId,
  });

  const pagesRendered = new Set(
    input.pageArtifacts.figures.map((f) => f.pageNum).filter((p) => p > 0)
  ).size;

  const attached = await attachVisualAssetsToModules({
    modules: placed.modules,
    manifest: effectiveManifest,
    pagesRendered,
    jobId: input.jobId,
    minPerLesson: 0,
    maxPerLesson: 2,
  });

  return attached.modules;
}
