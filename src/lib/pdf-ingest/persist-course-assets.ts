import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingDbColumnError } from "@/lib/supabase/schema-compat";
import type { PixelRect } from "@/lib/pdf-ingest/bbox-math";

export type CourseAssetType = "table" | "figure" | "image";

export type CourseAssetSource =
  | "structural_raster"
  | "structural_vector"
  | "vision_bbox"
  | "table_markdown"
  | "page_snapshot";

export type CourseAssetInsert = {
  job_id: string;
  study_material_id?: string | null;
  type: CourseAssetType;
  source: CourseAssetSource;
  source_page: number;
  asset_url?: string | null;
  markdown?: string | null;
  caption: string;
  caption_embedding?: number[] | null;
  bbox?: PixelRect | null;
  title?: string | null;
  description?: string | null;
  labels_json?: string[] | null;
  related_topics_json?: string[] | null;
  teaching_purpose?: string | null;
  when_to_use?: string | null;
  surrounding_text?: string | null;
};

/** Row loaded from `course_assets` for placement. */
export type CourseAssetRow = {
  id: string;
  type: CourseAssetType;
  source: CourseAssetSource;
  source_page: number;
  asset_url: string | null;
  markdown: string | null;
  caption: string;
  caption_embedding: number[] | null;
  bbox?: PixelRect | null;
  title?: string | null;
  description?: string | null;
  teaching_purpose?: string | null;
};

export async function deleteCourseAssetsForJob(
  admin: SupabaseClient,
  jobId: string
): Promise<void> {
  const { error } = await admin.from("course_assets").delete().eq("job_id", jobId);
  if (error && !isMissingDbColumnError(error, "course_assets")) {
    console.warn("[deleteCourseAssetsForJob]", jobId, error.message);
  }
}

export async function insertCourseAssets(
  admin: SupabaseClient,
  rows: CourseAssetInsert[]
): Promise<number> {
  if (rows.length === 0) return 0;

  const payload = rows.map((r) => ({
    job_id: r.job_id,
    study_material_id: r.study_material_id ?? null,
    type: r.type,
    source: r.source,
    source_page: r.source_page,
    asset_url: r.asset_url ?? null,
    markdown: r.markdown ?? null,
    caption: r.caption,
    caption_embedding: r.caption_embedding ?? null,
    bbox: r.bbox ?? null,
    title: r.title ?? null,
    description: r.description ?? null,
    labels_json: r.labels_json ?? [],
    related_topics_json: r.related_topics_json ?? [],
    teaching_purpose: r.teaching_purpose ?? null,
    when_to_use: r.when_to_use ?? null,
    surrounding_text: r.surrounding_text ?? null,
  }));

  const { error } = await admin.from("course_assets").insert(payload);
  if (error) {
    if (isMissingDbColumnError(error, "course_assets")) {
      console.error(
        "[insertCourseAssets] course_assets table missing — apply migration 073_course_assets.sql; placement will use ingest_asset_manifest"
      );
      return 0;
    }
    throw error;
  }
  return rows.length;
}

function parseEmbedding(raw: unknown): number[] | null {
  if (!Array.isArray(raw)) return null;
  const nums = raw.filter(
    (n): n is number => typeof n === "number" && Number.isFinite(n)
  );
  return nums.length > 0 ? nums : null;
}

export async function loadCourseAssetsForJob(
  admin: SupabaseClient,
  jobId: string
): Promise<CourseAssetRow[]> {
  const { data, error } = await admin
    .from("course_assets")
    .select(
      "id, type, source, source_page, asset_url, markdown, caption, caption_embedding, bbox, title, description, teaching_purpose"
    )
    .eq("job_id", jobId)
    .order("source_page", { ascending: true });

  if (error) {
    if (isMissingDbColumnError(error, "course_assets")) {
      console.warn(
        "[loadCourseAssetsForJob] course_assets table missing — using ingest_asset_manifest fallback"
      );
      return [];
    }
    throw error;
  }

  const out: CourseAssetRow[] = [];
  for (const row of data ?? []) {
    const r = row as Record<string, unknown>;
    const type = r.type;
    if (type !== "table" && type !== "figure" && type !== "image") continue;
    const sourcePage =
      typeof r.source_page === "number" && Number.isFinite(r.source_page)
        ? r.source_page
        : 0;
    if (sourcePage <= 0) continue;
    out.push({
      id: typeof r.id === "string" ? r.id : crypto.randomUUID(),
      type,
      source:
        r.source === "structural_raster" ||
        r.source === "structural_vector" ||
        r.source === "vision_bbox" ||
        r.source === "table_markdown" ||
        r.source === "page_snapshot"
          ? r.source
          : "table_markdown",
      source_page: sourcePage,
      asset_url:
        typeof r.asset_url === "string" && r.asset_url.trim()
          ? r.asset_url.trim()
          : null,
      markdown:
        typeof r.markdown === "string" && r.markdown.trim()
          ? r.markdown
          : null,
      caption: typeof r.caption === "string" ? r.caption : "",
      caption_embedding: parseEmbedding(r.caption_embedding),
      bbox:
        r.bbox && typeof r.bbox === "object"
          ? (r.bbox as PixelRect)
          : null,
      title: typeof r.title === "string" ? r.title : null,
      description: typeof r.description === "string" ? r.description : null,
      teaching_purpose:
        typeof r.teaching_purpose === "string" ? r.teaching_purpose : null,
    });
  }
  return out;
}

export async function linkCourseAssetsToMaterial(
  admin: SupabaseClient,
  jobId: string,
  materialId: string
): Promise<void> {
  const { error } = await admin
    .from("course_assets")
    .update({ study_material_id: materialId })
    .eq("job_id", jobId);
  if (error && !isMissingDbColumnError(error, "course_assets", "study_material_id")) {
    throw error;
  }
}
