import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

export async function findExistingFriendship(
  supabase: SupabaseClient,
  userA: string,
  userB: string
) {
  const { data } = await supabase
    .from("friendships")
    .select("id, requester_id, addressee_id, status")
    .or(
      `and(requester_id.eq.${userA},addressee_id.eq.${userB}),and(requester_id.eq.${userB},addressee_id.eq.${userA})`
    )
    .maybeSingle();
  return data;
}

export async function lookupProfileByUsername(
  username: string
): Promise<{
  id: string;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
} | null> {
  const admin = createAdminClient();
  if (!admin) return null;

  const { data, error } = await admin.rpc("lookup_profile_by_username", {
    p_username: username.trim(),
  });

  if (error || !data?.length) return null;
  const row = data[0] as {
    id: string;
    display_name: string | null;
    username: string | null;
    avatar_url: string | null;
  };
  return row;
}

export async function enrichProfiles(
  supabase: SupabaseClient,
  userIds: string[]
): Promise<
  Map<
    string,
    {
      id: string;
      displayName: string | null;
      username: string | null;
      avatarUrl: string | null;
    }
  >
> {
  const unique = [...new Set(userIds)];
  const map = new Map<
    string,
    {
      id: string;
      displayName: string | null;
      username: string | null;
      avatarUrl: string | null;
    }
  >();
  if (unique.length === 0) return map;

  const { data } = await supabase
    .from("profiles")
    .select("id, display_name, username, avatar_url")
    .in("id", unique);

  for (const p of data ?? []) {
    map.set(p.id, {
      id: p.id,
      displayName: p.display_name ?? null,
      username: p.username ?? null,
      avatarUrl: p.avatar_url ?? null,
    });
  }
  return map;
}

export async function getSenderProfileBits(
  supabase: SupabaseClient,
  userId: string
): Promise<{ displayName: string | null; username: string | null }> {
  const { data } = await supabase
    .from("profiles")
    .select("display_name, username")
    .eq("id", userId)
    .maybeSingle();
  return {
    displayName: data?.display_name ?? null,
    username: data?.username ?? null,
  };
}
