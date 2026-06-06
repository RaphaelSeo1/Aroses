import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_COURSE_OUTPUT_LANGUAGE,
  parseCourseOutputLanguage,
  type CourseOutputLanguage,
} from "@/lib/course-output-language";

export type CourseGenerationContext = {
  studyContext: string | null;
  outputLanguage: CourseOutputLanguage;
};

/** Per-job overrides, then course-level defaults. */
export async function loadCourseGenerationContext(
  supabase: SupabaseClient,
  jobId: string,
  courseId: string | null
): Promise<CourseGenerationContext> {
  let studyContext: string | null = null;
  let outputLanguage: CourseOutputLanguage = DEFAULT_COURSE_OUTPUT_LANGUAGE;

  const { data: jobRow, error: jobErr } = await supabase
    .from("pdf_ingest_jobs")
    .select("study_context, output_language")
    .eq("id", jobId)
    .maybeSingle();

  if (!jobErr && jobRow) {
    const rawCtx = (jobRow as { study_context?: unknown }).study_context;
    if (typeof rawCtx === "string" && rawCtx.trim()) {
      studyContext = rawCtx.trim();
    }
    outputLanguage = parseCourseOutputLanguage(
      (jobRow as { output_language?: unknown }).output_language
    );
  }

  if (!courseId) {
    return { studyContext, outputLanguage };
  }

  const { data: courseRow } = await supabase
    .from("courses")
    .select("study_context, output_language")
    .eq("id", courseId)
    .maybeSingle();

  if (!studyContext) {
    const raw = (courseRow as { study_context?: unknown } | null)?.study_context;
    if (typeof raw === "string" && raw.trim()) {
      studyContext = raw.trim();
    }
  }

  if (
    outputLanguage === DEFAULT_COURSE_OUTPUT_LANGUAGE &&
    courseRow &&
    (courseRow as { output_language?: unknown }).output_language
  ) {
    outputLanguage = parseCourseOutputLanguage(
      (courseRow as { output_language?: unknown }).output_language
    );
  }

  return { studyContext, outputLanguage };
}
