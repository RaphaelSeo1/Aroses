import type { SupabaseClient } from "@supabase/supabase-js";
import { upsertCourseProgress } from "@/lib/course-progress/db";
import type { CourseProgressPatch } from "@/types/course-progress";

/** Resolve `course_id` for a study material and upsert course progress. */
export async function syncCourseProgressFromMaterial(
  supabase: SupabaseClient,
  userId: string,
  materialId: string,
  patch: CourseProgressPatch
): Promise<void> {
  const { data: mat, error } = await supabase
    .from("study_materials")
    .select("course_id")
    .eq("id", materialId)
    .maybeSingle();

  if (error || !mat?.course_id) {
    if (error) console.error("[syncCourseProgressFromMaterial]", error);
    return;
  }

  await upsertCourseProgress(supabase, userId, mat.course_id as string, {
    materialId,
    ...patch,
  });
}
