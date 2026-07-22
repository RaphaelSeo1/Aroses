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

function rowFromDb(p: {
  id: string;
  display_name: string | null;
  username: string | null;
  avatar_url?: string | null;
}): ProfileLookupRow {
  return {
    id: p.id,
    display_name: p.display_name,
    username: p.username,
    avatar_url: p.avatar_url ?? null,
  };
}

/** Direct DB search — works even when friend-search RPC migrations are not applied yet. */
async function directProfileSearch(
  excludeUserId: string,
  query: string
): Promise<ProfileLookupRow[]> {
  const admin = createAdminClient();
  if (!admin) return [];

  const term = query.trim();
  if (term.length < 2) return [];

  const pattern = `${term.replace(/[%_,]/g, "")}%`;
  const { data, error } = await admin
    .from("profiles")
    .select("id, display_name, username")
    .neq("id", excludeUserId)
    .or(`username.ilike.${pattern},display_name.ilike.${pattern}`)
    .limit(10);

  if (error) {
    console.error("[directProfileSearch]", error.message);
    return [];
  }

  return (data ?? []).map((p) => rowFromDb(p as ProfileLookupRow));
}

async function rpcSearchProfiles(
  client: SupabaseClient,
  excludeUserId: string,
  query: string
): Promise<ProfileLookupRow[] | null> {
  const { data, error } = await client.rpc("search_profiles_for_friend_add", {
    p_query: query,
    p_exclude_user_id: excludeUserId,
  });

  if (error) {
    if (!/search_profiles_for_friend_add|schema cache|PGRST202/i.test(error.message)) {
      console.error("[search_profiles_for_friend_add]", error.message);
    }
    return null;
  }

  return (data as ProfileLookupRow[] | null)?.map(rowFromDb) ?? [];
}

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
  if (!exactErr && exact?.length) {
    return (exact as ProfileLookupRow[]).map(rowFromDb);
  }

  const { data: prefix, error: prefixErr } = await client.rpc(
    "lookup_profiles_by_username_prefix",
    { p_prefix: normalized }
  );
  if (!prefixErr && prefix?.length) {
    return (prefix as ProfileLookupRow[]).map(rowFromDb);
  }
  return [];
}

async function searchProfilesInternal(
  supabase: SupabaseClient,
  excludeUserId: string,
  query: string
): Promise<ProfileLookupRow[]> {
  const rpc = await rpcSearchProfiles(supabase, excludeUserId, query);
  if (rpc && rpc.length > 0) {
    return rpc.filter((p) => p.id !== excludeUserId);
  }

  const legacy = await legacyUsernameSearch(supabase, query).catch(() => []);
  const legacyFiltered = legacy.filter((p) => p.id !== excludeUserId);
  if (legacyFiltered.length > 0) return legacyFiltered;

  const direct = await directProfileSearch(excludeUserId, query);
  if (direct.length > 0) return direct;

  return rpc ?? [];
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
  excludeUserId: string,
  rawQuery: string
): Promise<FriendUsernameResolveResult> {
  const query = normalizeFriendQuery(rawQuery);
  if (query.length < 2) return { status: "not_found" };

  const matches = await searchProfilesInternal(supabase, excludeUserId, query);

  if (matches.length > 1) {
    const exactUsername = matches.filter(
      (m) => m.username?.toLowerCase() === query.toLowerCase()
    );
    if (exactUsername.length === 1) {
      return { status: "found", profile: exactUsername[0]! };
    }
    return { status: "ambiguous", suggestions: matches };
  }

  if (matches.length === 1) return { status: "found", profile: matches[0]! };
  return { status: "not_found" };
}

export async function searchProfilesForFriendAdd(
  supabase: SupabaseClient,
  excludeUserId: string,
  rawQuery: string
): Promise<ProfileLookupRow[]> {
  const query = normalizeFriendQuery(rawQuery);
  if (query.length < 2) return [];

  return searchProfilesInternal(supabase, excludeUserId, query);
}

export type SameSchoolSuggestion = ProfileLookupRow & {
  school_name: string | null;
};

/** People who share the viewer's school (RPC; falls back to admin direct query). */
export async function suggestProfilesSameSchool(
  supabase: SupabaseClient,
  viewerId: string,
  limit = 12
): Promise<SameSchoolSuggestion[]> {
  const { data, error } = await supabase.rpc("suggest_profiles_same_school", {
    p_viewer_id: viewerId,
    p_limit: limit,
  });

  if (!error && data) {
    return (data as SameSchoolSuggestion[]).map((p) => ({
      id: p.id,
      display_name: p.display_name,
      username: p.username,
      avatar_url: p.avatar_url ?? null,
      school_name: p.school_name ?? null,
    }));
  }

  if (
    error &&
    !/suggest_profiles_same_school|schema cache|PGRST202/i.test(error.message)
  ) {
    console.error("[suggest_profiles_same_school]", error.message);
  }

  // Fallback when RPC isn't migrated yet.
  const admin = createAdminClient();
  if (!admin) return [];

  const { data: me } = await admin
    .from("profiles")
    .select("school_name")
    .eq("id", viewerId)
    .maybeSingle();
  const school =
    typeof me?.school_name === "string" ? me.school_name.trim() : "";
  if (!school) return [];

  const { data: friends } = await admin
    .from("friendships")
    .select("requester_id, addressee_id, status")
    .or(`requester_id.eq.${viewerId},addressee_id.eq.${viewerId}`)
    .in("status", ["pending", "accepted", "blocked"]);

  const blocked = new Set<string>([viewerId]);
  for (const f of friends ?? []) {
    blocked.add(
      f.requester_id === viewerId ? f.addressee_id : f.requester_id
    );
  }

  const { data: rows } = await admin
    .from("profiles")
    .select("id, display_name, username, avatar_url, school_name")
    .ilike("school_name", school)
    .neq("id", viewerId)
    .limit(40);

  return (rows ?? [])
    .filter((p) => !blocked.has(p.id))
    .filter(
      (p) =>
        typeof p.school_name === "string" &&
        p.school_name.trim().toLowerCase() === school.toLowerCase()
    )
    .slice(0, limit)
    .map((p) => ({
      id: p.id,
      display_name: p.display_name,
      username: p.username,
      avatar_url: p.avatar_url ?? null,
      school_name: p.school_name ?? null,
    }));
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

  let data: {
    id: string;
    display_name: string | null;
    username: string | null;
    avatar_url?: string | null;
  }[] | null = null;

  const withAvatar = await supabase
    .from("profiles")
    .select("id, display_name, username, avatar_url")
    .in("id", unique);

  if (withAvatar.error?.message?.includes("avatar_url")) {
    const fallback = await supabase
      .from("profiles")
      .select("id, display_name, username")
      .in("id", unique);
    data = fallback.data;
  } else {
    data = withAvatar.data;
  }

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
