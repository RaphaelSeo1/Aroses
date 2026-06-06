import type { SupabaseClient } from "@supabase/supabase-js";

/** Per-upload goal on the job row, else course-level `study_context`. */
export async function loadStudyContextForMaterial(
  supabase: SupabaseClient,
  materialId: string,
  jobId?: string | null
): Promise<string | null> {
  if (jobId) {
    const { data: jobCtx, error: jobErr } = await supabase
      .from("pdf_ingest_jobs")
      .select("study_context")
      .eq("id", jobId)
      .maybeSingle();
    if (!jobErr) {
      const raw = (jobCtx as { study_context?: unknown } | null)?.study_context;
      if (typeof raw === "string" && raw.trim().length > 0) {
        return raw.trim();
      }
    }
  }

  const { data: mat } = await supabase
    .from("study_materials")
    .select("course_id")
    .eq("id", materialId)
    .maybeSingle();

  const courseId =
    typeof mat?.course_id === "string" ? mat.course_id : null;
  if (!courseId) return null;

  const { data: course } = await supabase
    .from("courses")
    .select("study_context")
    .eq("id", courseId)
    .maybeSingle();

  const raw = course?.study_context;
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : null;
}
