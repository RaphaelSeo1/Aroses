import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_COURSE_OUTPUT_LANGUAGE,
  parseCourseOutputLanguage,
  type CourseOutputLanguage,
} from "@/lib/course-output-language";

/**
 * Resolve the course's output / teaching language for a study material.
 * Used by Mentored Learning APIs so Rose teaches in the language the
 * student chose at upload time (or "auto" → match source).
 */
export async function loadCourseOutputLanguageForMaterial(
  supabase: SupabaseClient,
  materialId: string
): Promise<CourseOutputLanguage> {
  const { data: mat } = await supabase
    .from("study_materials")
    .select("course_id")
    .eq("id", materialId)
    .maybeSingle();

  if (!mat?.course_id) {
    return DEFAULT_COURSE_OUTPUT_LANGUAGE;
  }

  const { data: course } = await supabase
    .from("courses")
    .select("output_language")
    .eq("id", mat.course_id)
    .maybeSingle();

  return parseCourseOutputLanguage(
    (course as { output_language?: unknown } | null)?.output_language
  );
}
