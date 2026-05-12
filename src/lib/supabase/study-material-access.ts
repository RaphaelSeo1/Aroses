import type { SupabaseClient } from "@supabase/supabase-js";

import { fetchIsDbSuperAdmin } from "@/lib/db-super-admin";

/**
 * True if this signed-in user may load this study material (owner or public course).
 */
export async function canAccessStudyMaterial(
  supabase: SupabaseClient,
  userId: string,
  materialId: string
): Promise<boolean> {
  const { data: row, error } = await supabase
    .from("study_materials")
    .select("user_id, course_id")
    .eq("id", materialId)
    .maybeSingle();

  if (error || !row) return false;
  if (row.user_id === userId) return true;
  if (await fetchIsDbSuperAdmin(supabase)) return true;

  const { data: course, error: ce } = await supabase
    .from("courses")
    .select("is_public")
    .eq("id", row.course_id)
    .maybeSingle();

  if (ce || !course) return false;
  return Boolean(course.is_public);
}
