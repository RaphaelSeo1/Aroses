import type { SupabaseClient } from "@supabase/supabase-js";
import { parseUsername } from "@/lib/onboarding";
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

async function rpcLookupExact(
  client: SupabaseClient,
  username: string
): Promise<ProfileLookupRow | null> {
  const { data, error } = await client.rpc("lookup_profile_by_username", {
    p_username: username,
  });
  if (error || !data?.length) return null;
  return data[0] as ProfileLookupRow;
}

async function rpcLookupPrefix(
  client: SupabaseClient,
  prefix: string
): Promise<ProfileLookupRow[]> {
  const { data, error } = await client.rpc("lookup_profiles_by_username_prefix", {
    p_prefix: prefix,
  });
  if (error || !data?.length) return [];
  return data as ProfileLookupRow[];
}

async function withRpcFallback<T>(
  supabase: SupabaseClient,
  fn: (client: SupabaseClient) => Promise<T>,
  empty: T
): Promise<T> {
  const primary = await fn(supabase);
  const hasPrimary = Array.isArray(primary)
    ? primary.length > 0
    : primary != null;
  if (hasPrimary) return primary;

  const admin = createAdminClient();
  if (!admin) return primary;
  return fn(admin);
}

/** Exact username match for friend add. Uses session RPC (not admin-only). */
export async function lookupProfileByUsername(
  supabase: SupabaseClient,
  rawUsername: string
): Promise<ProfileLookupRow | null> {
  const parsed = parseUsername(rawUsername.replace(/^@/, ""));
  if (!parsed) return null;

  return withRpcFallback(supabase, (client) => rpcLookupExact(client, parsed), null);
}

export type FriendUsernameResolveResult =
  | { status: "found"; profile: ProfileLookupRow }
  | { status: "ambiguous"; suggestions: ProfileLookupRow[] }
  | { status: "not_found" };

/** Exact match first; if none, accept a single prefix match. */
export async function resolveProfileForFriendAdd(
  supabase: SupabaseClient,
  rawUsername: string
): Promise<FriendUsernameResolveResult> {
  const parsed = parseUsername(rawUsername.replace(/^@/, ""));
  if (!parsed) return { status: "not_found" };

  const exact = await withRpcFallback(
    supabase,
    (client) => rpcLookupExact(client, parsed),
    null
  );
  if (exact) return { status: "found", profile: exact };

  const prefixMatches = await withRpcFallback(
    supabase,
    (client) => rpcLookupPrefix(client, parsed),
    []
  );
  if (prefixMatches.length === 1) {
    return { status: "found", profile: prefixMatches[0]! };
  }
  if (prefixMatches.length > 1) {
    return { status: "ambiguous", suggestions: prefixMatches };
  }
  return { status: "not_found" };
}

export async function searchProfilesByUsernamePrefix(
  supabase: SupabaseClient,
  rawPrefix: string
): Promise<ProfileLookupRow[]> {
  const parsed = parseUsername(rawPrefix.replace(/^@/, ""));
  if (!parsed || parsed.length < 2) return [];

  return withRpcFallback(
    supabase,
    (client) => rpcLookupPrefix(client, parsed),
    []
  );
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
