import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SocialBadgeCounts } from "@/lib/messaging/social-badge-types";
import { fetchUnreadMessageCount } from "@/lib/messaging/unread-count";

export type { SocialBadgeCounts };

export async function fetchSocialBadgeCounts(
  supabase: SupabaseClient,
  userId: string
): Promise<SocialBadgeCounts> {
  const [unreadMessages, pendingRes] = await Promise.all([
    fetchUnreadMessageCount(supabase, userId),
    supabase
      .from("friendships")
      .select("id", { count: "exact", head: true })
      .eq("addressee_id", userId)
      .eq("status", "pending"),
  ]);

  const pendingFriendRequests =
    pendingRes.error != null ? 0 : (pendingRes.count ?? 0);

  return {
    unreadMessages,
    pendingFriendRequests,
    total: unreadMessages + pendingFriendRequests,
  };
}
