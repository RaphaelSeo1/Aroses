import { createAdminClient } from "@/lib/supabase/admin";

export type ResolvedShare = {
  courseId: string;
  ownerUserId: string;
  shareId: string;
  createdAt: string;
};

/**
 * Resolve a share token to its course. Uses the service-role admin client
 * because anonymous viewers do not have a session — the token IS the
 * authorization. Returns null when:
 *  - admin client is not configured (missing env)
 *  - the token doesn't exist
 *  - the token has been revoked
 */
export async function resolveShareToken(
  token: string
): Promise<ResolvedShare | null> {
  if (!token || typeof token !== "string") return null;

  const admin = createAdminClient();
  if (!admin) return null;

  const { data, error } = await admin
    .from("course_shares")
    .select("id, course_id, user_id, created_at, revoked_at")
    .eq("token", token)
    .maybeSingle();

  if (error) {
    // Table not present yet (migration 029 not applied) → treat as not found.
    const msg = error.message ?? "";
    if (error.code === "42P01" || msg.includes("course_shares")) return null;
    console.error("[resolveShareToken]", error);
    return null;
  }

  if (!data || data.revoked_at) return null;

  return {
    courseId: data.course_id as string,
    ownerUserId: data.user_id as string,
    shareId: data.id as string,
    createdAt: data.created_at as string,
  };
}
