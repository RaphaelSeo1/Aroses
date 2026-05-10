import type { SupabaseClient } from "@supabase/supabase-js";

export type DashboardCourseRow = {
  id: string;
  title: string;
  description: string;
  created_at: string;
  is_public: boolean;
};

/**
 * Loads a course for the dashboard. If `is_public` column is missing (migration
 * 007 not applied), falls back to a smaller select so the course page still works.
 */
export async function fetchCourseForDashboard(
  supabase: SupabaseClient,
  courseId: string
): Promise<DashboardCourseRow | null> {
  const primary = await supabase
    .from("courses")
    .select("id, title, description, created_at, is_public")
    .eq("id", courseId)
    .maybeSingle();

  if (primary.data) {
    return {
      ...primary.data,
      is_public: Boolean(primary.data.is_public),
    };
  }

  const msg = primary.error?.message ?? "";
  const code = primary.error?.code;
  const missingPublicColumn =
    code === "42703" ||
    msg.includes("is_public") ||
    msg.includes("schema cache");

  if (primary.error && !missingPublicColumn) {
    console.error(primary.error);
    return null;
  }

  const fallback = await supabase
    .from("courses")
    .select("id, title, description, created_at")
    .eq("id", courseId)
    .maybeSingle();

  if (fallback.error) {
    console.error(fallback.error);
    return null;
  }
  if (!fallback.data) return null;

  return { ...fallback.data, is_public: false };
}
