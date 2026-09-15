import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_COURSE_OUTPUT_LANGUAGE,
  parseCourseOutputLanguage,
  type CourseOutputLanguage,
} from "@/lib/course-output-language";
import type { CourseGenerationDepth } from "@/lib/billing/plans";
import { parseCourseGenerationDepth } from "@/lib/ai/generation-depth-config";

export type CourseGenerationContext = {
  studyContext: string | null;
  outputLanguage: CourseOutputLanguage;
  generationDepth: CourseGenerationDepth | null;
  billingTierSnapshot: string | null;
};

/** Per-job overrides, then course-level defaults. */
export async function loadCourseGenerationContext(
  supabase: SupabaseClient,
  jobId: string,
  courseId: string | null
): Promise<CourseGenerationContext> {
  let studyContext: string | null = null;
  let outputLanguage: CourseOutputLanguage = DEFAULT_COURSE_OUTPUT_LANGUAGE;
  let generationDepth: CourseGenerationDepth | null = null;
  let billingTierSnapshot: string | null = null;

  const { data: jobRow, error: jobErr } = await supabase
    .from("pdf_ingest_jobs")
    .select(
      "study_context, output_language, generation_depth, billing_tier_snapshot"
    )
    .eq("id", jobId)
    .maybeSingle();

  if (jobErr && /generation_depth|billing_tier_snapshot/i.test(jobErr.message ?? "")) {
    const legacy = await supabase
      .from("pdf_ingest_jobs")
      .select("study_context, output_language")
      .eq("id", jobId)
      .maybeSingle();
    if (!legacy.error && legacy.data) {
      const rawCtx = (legacy.data as { study_context?: unknown }).study_context;
      if (typeof rawCtx === "string" && rawCtx.trim()) {
        studyContext = rawCtx.trim();
      }
      outputLanguage = parseCourseOutputLanguage(
        (legacy.data as { output_language?: unknown }).output_language
      );
    }
  } else if (!jobErr && jobRow) {
    const rawCtx = (jobRow as { study_context?: unknown }).study_context;
    if (typeof rawCtx === "string" && rawCtx.trim()) {
      studyContext = rawCtx.trim();
    }
    outputLanguage = parseCourseOutputLanguage(
      (jobRow as { output_language?: unknown }).output_language
    );
    generationDepth = parseCourseGenerationDepth(
      (jobRow as { generation_depth?: unknown }).generation_depth
    );
    const tierRaw = (jobRow as { billing_tier_snapshot?: unknown })
      .billing_tier_snapshot;
    if (typeof tierRaw === "string" && tierRaw.trim()) {
      billingTierSnapshot = tierRaw.trim();
    }
  }

  if (!courseId) {
    return { studyContext, outputLanguage, generationDepth, billingTierSnapshot };
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

  return { studyContext, outputLanguage, generationDepth, billingTierSnapshot };
}
