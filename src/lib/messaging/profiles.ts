import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

export type ProfileLookupRow = {
  id: string;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
};

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

async function rpcSearchProfiles(
  client: SupabaseClient,
  query: string
): Promise<ProfileLookupRow[]> {
  const { data, error } = await client.rpc("search_profiles_for_friend_add", {
    p_query: query,
  });
  if (error) {
    console.error("[search_profiles_for_friend_add]", error.message);
    return legacyUsernameSearch(client, query);
  }
  if (!data?.length) return legacyUsernameSearch(client, query);
  return data as ProfileLookupRow[];
}

/** Fallback when migration 063 is not applied yet. */
async function legacyUsernameSearch(
  client: SupabaseClient,
  query: string
): Promise<ProfileLookupRow[]> {
  const normalized = query.trim().toLowerCase();
  if (normalized.length < 2) return [];

  const { data: exact, error: exactErr } = await client.rpc(
    "lookup_profile_by_username",
    { p_username: normalized }
  );
  if (!exactErr && exact?.length) return exact as ProfileLookupRow[];

  const { data: prefix, error: prefixErr } = await client.rpc(
    "lookup_profiles_by_username_prefix",
    { p_prefix: normalized }
  );
  if (!prefixErr && prefix?.length) return prefix as ProfileLookupRow[];
  return [];
}

async function withRpcFallback(
  supabase: SupabaseClient,
  fn: (client: SupabaseClient) => Promise<ProfileLookupRow[]>
): Promise<ProfileLookupRow[]> {
  const primary = await fn(supabase);
  if (primary.length > 0) return primary;

  const admin = createAdminClient();
  if (!admin) return primary;
  return fn(admin);
}

export type FriendUsernameResolveResult =
  | { status: "found"; profile: ProfileLookupRow }
  | { status: "ambiguous"; suggestions: ProfileLookupRow[] }
  | { status: "not_found" };

function normalizeFriendQuery(raw: string): string {
  return raw.trim().replace(/^@/, "");
}

/** Match by @username or display name (prefix or exact). */
export async function resolveProfileForFriendAdd(
  supabase: SupabaseClient,
  rawQuery: string
): Promise<FriendUsernameResolveResult> {
  const query = normalizeFriendQuery(rawQuery);
  if (query.length < 2) return { status: "not_found" };

  const matches = await withRpcFallback(supabase, (client) =>
    rpcSearchProfiles(client, query)
  );

  if (matches.length === 1) return { status: "found", profile: matches[0]! };
  if (matches.length > 1) {
    return { status: "ambiguous", suggestions: matches };
  }
  return { status: "not_found" };
}

export async function searchProfilesForFriendAdd(
  supabase: SupabaseClient,
  rawQuery: string
): Promise<ProfileLookupRow[]> {
  const query = normalizeFriendQuery(rawQuery);
  if (query.length < 2) return [];

  return withRpcFallback(supabase, (client) => rpcSearchProfiles(client, query));
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
