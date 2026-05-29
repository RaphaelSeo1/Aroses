import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingDbColumnError } from "@/lib/supabase/schema-compat";

const STUDY_MATERIAL_SELECT_BASE =
  "id, summary, key_concepts, questions, course_id, file_name, course_payload";

/**
 * Load a study material row; omits `ingest_media` if migration 039 is not applied yet.
 */
export async function selectStudyMaterialById(
  supabase: SupabaseClient,
  materialId: string,
  courseId: string
) {
  const withMedia = `${STUDY_MATERIAL_SELECT_BASE}, ingest_media`;
  let result = await supabase
    .from("study_materials")
    .select(withMedia)
    .eq("id", materialId)
    .eq("course_id", courseId)
    .maybeSingle();

  if (
    result.error &&
    isMissingDbColumnError(result.error, "ingest_media")
  ) {
    result = await supabase
      .from("study_materials")
      .select(STUDY_MATERIAL_SELECT_BASE)
      .eq("id", materialId)
      .eq("course_id", courseId)
      .maybeSingle();
  }

  return result;
}

export async function selectLatestStudyMaterialForCourse(
  supabase: SupabaseClient,
  courseId: string
) {
  const withMedia = `${STUDY_MATERIAL_SELECT_BASE}, ingest_media`;
  let result = await supabase
    .from("study_materials")
    .select(withMedia)
    .eq("course_id", courseId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (
    result.error &&
    isMissingDbColumnError(result.error, "ingest_media")
  ) {
    result = await supabase
      .from("study_materials")
      .select(STUDY_MATERIAL_SELECT_BASE)
      .eq("course_id", courseId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
  }

  return result;
}
