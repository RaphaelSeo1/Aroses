import { NextResponse } from "next/server";
import {
  enrichProfiles,
  findExistingFriendship,
  resolveProfileForFriendAdd,
  type ProfileLookupRow,
} from "@/lib/messaging/profiles";
import type { FriendshipListItem, FriendProfile } from "@/lib/messaging/types";
import { createClient } from "@/lib/supabase/server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function toFriendProfile(
  id: string,
  map: Map<string, { id: string; displayName: string | null; username: string | null; avatarUrl: string | null }>
): FriendProfile {
  const p = map.get(id);
  return {
    id,
    displayName: p?.displayName ?? null,
    username: p?.username ?? null,
    avatarUrl: p?.avatarUrl ?? null,
  };
}

function missingTable(error: { code?: string; message?: string }) {
  const msg = error.message ?? "";
  return error.code === "42P01" || msg.includes("friendships") || msg.includes("schema cache");
}

/** GET — friends + pending requests. */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const { data: rows, error } = await supabase
    .from("friendships")
    .select("id, requester_id, addressee_id, status, created_at, accepted_at")
    .order("updated_at", { ascending: false });

  if (error) {
    if (missingTable(error)) {
      return NextResponse.json({ friends: [], incoming: [], outgoing: [] });
    }
    console.error("[friends GET]", error);
    return NextResponse.json({ error: "Could not load friends." }, { status: 500 });
  }

  const userIds = new Set<string>();
  for (const r of rows ?? []) {
    userIds.add(r.requester_id);
    userIds.add(r.addressee_id);
  }
  const profileMap = await enrichProfiles(supabase, [...userIds]);

  const friends: FriendshipListItem[] = [];
  const incoming: FriendshipListItem[] = [];
  const outgoing: FriendshipListItem[] = [];

  for (const r of rows ?? []) {
    const isRequester = r.requester_id === user.id;
    const otherId = isRequester ? r.addressee_id : r.requester_id;
    const item: FriendshipListItem = {
      id: r.id,
      status: r.status,
      direction: r.status === "pending" ? (isRequester ? "outgoing" : "incoming") : "none",
      friend: toFriendProfile(otherId, profileMap),
      createdAt: r.created_at,
      acceptedAt: r.accepted_at,
    };
    if (r.status === "accepted") friends.push(item);
    else if (r.status === "pending" && isRequester) outgoing.push(item);
    else if (r.status === "pending" && !isRequester) incoming.push(item);
  }

  friends.sort((a, b) =>
    (a.friend.displayName ?? a.friend.username ?? "").localeCompare(
      b.friend.displayName ?? b.friend.username ?? ""
    )
  );

  return NextResponse.json({ friends, incoming, outgoing });
}

/** POST — send friend request by username. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const query =
    typeof (body as { username?: unknown }).username === "string"
      ? (body as { username: string }).username.trim().replace(/^@/, "")
      : "";
  const targetUserId =
    typeof (body as { userId?: unknown }).userId === "string"
      ? (body as { userId: string }).userId
      : null;

  if (!targetUserId && query.length < 2) {
    return NextResponse.json(
      { error: "Enter at least 2 characters to search." },
      { status: 400 }
    );
  }

  let profile: ProfileLookupRow | null = null;

  if (targetUserId && UUID_RE.test(targetUserId)) {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const admin = createAdminClient();
    const lookup = admin ?? supabase;
    const { data: row } = await lookup
      .from("profiles")
      .select("id, display_name, username")
      .eq("id", targetUserId)
      .maybeSingle();
    if (!row || row.id === user.id) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }
    profile = {
      id: row.id,
      display_name: row.display_name,
      username: row.username,
      avatar_url: null,
    };
  } else {
    const resolved = await resolveProfileForFriendAdd(supabase, user.id, query);
    if (resolved.status === "ambiguous") {
      return NextResponse.json(
        {
          error: "Several people match — pick one from the list below.",
          suggestions: resolved.suggestions.map((p) => ({
            id: p.id,
            username: p.username,
            displayName: p.display_name,
          })),
        },
        { status: 409 }
      );
    }
    if (resolved.status === "not_found") {
      return NextResponse.json(
        {
          error:
            "No one matched that search. Double-check their @username on Profile → General.",
        },
        { status: 404 }
      );
    }
    profile = resolved.profile;
  }

  if (!profile) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }
  if (profile.id === user.id) {
    return NextResponse.json({ error: "You cannot add yourself." }, { status: 400 });
  }

  const existing = await findExistingFriendship(supabase, user.id, profile.id);
  if (existing) {
    if (existing.status === "accepted") {
      return NextResponse.json({ error: "You are already friends." }, { status: 409 });
    }
    if (existing.status === "pending") {
      return NextResponse.json({ error: "Friend request already pending." }, { status: 409 });
    }
    if (existing.status === "blocked") {
      return NextResponse.json({ error: "Cannot send request." }, { status: 403 });
    }
    const now = new Date().toISOString();
    const { data: revived, error: reviveErr } = await supabase
      .from("friendships")
      .update({
        requester_id: user.id,
        addressee_id: profile.id,
        status: "pending",
        blocked_by: null,
        updated_at: now,
        accepted_at: null,
      })
      .eq("id", existing.id)
      .select("id")
      .single();
    if (reviveErr) {
      console.error("[friends POST revive]", reviveErr);
      return NextResponse.json({ error: "Could not send request." }, { status: 500 });
    }
    return NextResponse.json({ friendshipId: revived.id, userId: profile.id });
  }

  const { data: created, error } = await supabase
    .from("friendships")
    .insert({
      requester_id: user.id,
      addressee_id: profile.id,
      status: "pending",
    })
    .select("id")
    .single();

  if (error) {
    if (missingTable(error)) {
      return NextResponse.json(
        {
          error:
            "Friends is not set up on the database yet. Apply Supabase migrations 060–064 (friends + messaging).",
        },
        { status: 503 }
      );
    }
    console.error("[friends POST]", error);
    return NextResponse.json({ error: "Could not send request." }, { status: 500 });
  }

  // TODO: email notification when outbound email is configured.
  return NextResponse.json({ friendshipId: created.id, userId: profile.id });
}
