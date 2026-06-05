import type { SupabaseClient } from "@supabase/supabase-js";

import { canViewCourse } from "@/lib/collaboration/permissions";
import { fetchIsDbSuperAdmin } from "@/lib/db-super-admin";
import { hasPurchasedCourse } from "@/lib/marketplace/purchases";

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
    .select("is_public, user_id")
    .eq("id", row.course_id)
    .maybeSingle();

  if (ce || !course) return false;
  if (course.user_id === userId) return true;
  if (await canViewCourse(supabase, userId, row.course_id)) return true;
  if (course.is_public) return true;
  if (await hasPurchasedCourse(supabase, userId, row.course_id)) return true;

  const { data: listing } = await supabase
    .from("course_listings")
    .select("status")
    .eq("course_id", row.course_id)
    .maybeSingle();

  if (listing?.status === "approved") {
    return false;
  }

  return false;
}
