import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

/** Attach pending email invites to a user after sign-in. */
export async function linkPendingInvitesForUser(
  userId: string,
  email: string | null | undefined
): Promise<void> {
  const normalized = email?.trim().toLowerCase();
  if (!normalized) return;

  const admin = createAdminClient();
  if (!admin) return;

  await admin
    .from("course_collaborators")
    .update({
      user_id: userId,
      updated_at: new Date().toISOString(),
    })
    .eq("status", "pending")
    .is("user_id", null)
    .ilike("invited_email", normalized);
}

export async function linkPendingInvitesWithClient(
  supabase: SupabaseClient,
  userId: string
): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.id !== userId) return;
  await linkPendingInvitesForUser(userId, user.email);
}
