import type { SupabaseClient } from "@supabase/supabase-js";

import { fetchIsDbSuperAdmin } from "@/lib/db-super-admin";

export type DashboardCourseRow = {
  id: string;
  title: string;
  description: string;
  created_at: string;
  is_public: boolean;
  is_self_study?: boolean;
  study_context?: string | null;
  /** Present when `025_app_super_admins.sql` is applied and you are in `app_super_admins`. */
  owner_user_id?: string;
};

/**
 * Loads a course for the creator workspace (`/dashboard/courses/...`).
 * RLS returns the row when you own it or you are a DB super-admin (`app_super_admins`).
 */
export async function fetchCourseForDashboard(
  supabase: SupabaseClient,
  courseId: string,
  viewerUserId: string
): Promise<DashboardCourseRow | null> {
  type Row = {
    user_id: string;
    id: string;
    title: string;
    description: string;
    created_at: string;
    is_public?: boolean | null;
    is_self_study?: boolean | null;
    study_context?: string | null;
  };

  let row: Row | null = null;

  const primary = await supabase
    .from("courses")
    .select("id, user_id, title, description, created_at, is_public, is_self_study, study_context")
    .eq("id", courseId)
    .maybeSingle();

  if (primary.data) {
    row = primary.data as Row;
  } else if (primary.error) {
    const msg = primary.error.message ?? "";
    const code = primary.error.code;
    const missingIsPublic =
      code === "42703" ||
      msg.includes("is_public") ||
      msg.includes("schema cache");
    if (!missingIsPublic) {
      console.error(primary.error);
      return null;
    }
    const fb = await supabase
      .from("courses")
      .select("id, user_id, title, description, created_at")
      .eq("id", courseId)
      .maybeSingle();
    if (fb.error || !fb.data) {
      if (fb.error) console.error(fb.error);
      return null;
    }
    row = { ...fb.data, is_public: false } as Row;
  } else {
    return null;
  }

  const rowUserId = typeof row.user_id === "string" ? row.user_id : "";
  if (rowUserId !== viewerUserId) {
    const isAdmin = await fetchIsDbSuperAdmin(supabase);
    if (!isAdmin) return null;
  }

  const { user_id: ownerUserId, ...rest } = row;

  return {
    id: rest.id,
    title: rest.title,
    description: rest.description,
    created_at: rest.created_at,
    is_public: Boolean(rest.is_public),
    is_self_study: Boolean(rest.is_self_study),
    study_context: rest.study_context ?? null,
    owner_user_id: ownerUserId,
  };
}
