import type { SupabaseClient, User } from "@supabase/supabase-js";

/**
 * Best-effort public display name for a forum author. Prefers the user's
 * profile display name, then the email local-part, then a neutral fallback.
 * Stored denormalized on the post/comment row so the public board never needs
 * to read other users' profiles.
 */
export async function resolveForumAuthorName(
  supabase: SupabaseClient,
  user: User
): Promise<string> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .maybeSingle();

  const fromProfile = profile?.display_name?.trim();
  if (fromProfile) return fromProfile.slice(0, 60);

  const email = user.email ?? "";
  const local = email.split("@")[0]?.trim();
  if (local) return local.slice(0, 60);

  return "Member";
}
