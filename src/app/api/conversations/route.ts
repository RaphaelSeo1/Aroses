import { NextResponse } from "next/server";
import {
  buildContextLabel,
  createDirectConversation,
  createGroupConversation,
} from "@/lib/messaging/conversations";
import { enrichProfiles } from "@/lib/messaging/profiles";
import type { ConversationListItem, FriendProfile } from "@/lib/messaging/types";
import { createClient } from "@/lib/supabase/server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function missingTable(error: { code?: string; message?: string }) {
  const msg = error.message ?? "";
  return (
    error.code === "42P01" ||
    msg.includes("conversations") ||
    msg.includes("schema cache")
  );
}

/** GET — inbox list. */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const { data: memberships, error: memErr } = await supabase
    .from("conversation_participants")
    .select("conversation_id, last_read_at")
    .eq("user_id", user.id);

  if (memErr) {
    if (missingTable(memErr)) return NextResponse.json({ conversations: [] });
    return NextResponse.json({ error: "Could not load inbox." }, { status: 500 });
  }

  const convIds = (memberships ?? []).map((m) => m.conversation_id);
  if (convIds.length === 0) return NextResponse.json({ conversations: [] });

  const readAt = new Map(
    (memberships ?? []).map((m) => [m.conversation_id, m.last_read_at])
  );

  const { data: convs, error } = await supabase
    .from("conversations")
    .select(
      "id, type, title, course_id, last_message_at, last_message_preview, created_at"
    )
    .in("id", convIds)
    .order("last_message_at", { ascending: false, nullsFirst: false });

  if (error) {
    console.error("[conversations GET]", error);
    return NextResponse.json({ error: "Could not load inbox." }, { status: 500 });
  }

  const { data: allParts } = await supabase
    .from("conversation_participants")
    .select("conversation_id, user_id")
    .in("conversation_id", convIds);

  const userIds = new Set<string>();
  for (const p of allParts ?? []) userIds.add(p.user_id);
  const profileMap = await enrichProfiles(supabase, [...userIds]);

  const courseIds = [
    ...new Set(
      (convs ?? [])
        .map((c) => c.course_id)
        .filter((id): id is string => typeof id === "string")
    ),
  ];
  const courseTitleById = new Map<string, string>();
  if (courseIds.length > 0) {
    const { data: courses } = await supabase
      .from("courses")
      .select("id, title")
      .in("id", courseIds);
    for (const c of courses ?? []) courseTitleById.set(c.id, c.title);
  }

  const conversations: ConversationListItem[] = [];

  for (const c of convs ?? []) {
    const participantIds = (allParts ?? [])
      .filter((p) => p.conversation_id === c.id)
      .map((p) => p.user_id);

    const others = participantIds.filter((id) => id !== user.id);
    const participants: FriendProfile[] = others.map((id) => {
      const p = profileMap.get(id);
      return {
        id,
        displayName: p?.displayName ?? null,
        username: p?.username ?? null,
        avatarUrl: p?.avatarUrl ?? null,
      };
    });

    const { count: unreadCount } = await supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", c.id)
      .neq("sender_id", user.id)
      .gt("created_at", readAt.get(c.id) ?? new Date(0).toISOString());

    conversations.push({
      id: c.id,
      type: c.type as "direct" | "group",
      title: c.title,
      courseId: c.course_id,
      courseTitle: c.course_id ? courseTitleById.get(c.course_id) ?? null : null,
      lastMessageAt: c.last_message_at,
      lastMessagePreview: c.last_message_preview,
      unreadCount: unreadCount ?? 0,
      participants,
      isGroup: c.type === "group",
    });
  }

  return NextResponse.json({ conversations });
}

/** POST — create direct or group conversation. */
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

  const b = body as {
    type?: unknown;
    userId?: unknown;
    title?: unknown;
    memberIds?: unknown;
    courseId?: unknown;
  };

  if (b.type === "direct" || typeof b.userId === "string") {
    const otherId = b.userId;
    if (typeof otherId !== "string" || !UUID_RE.test(otherId)) {
      return NextResponse.json({ error: "Invalid user id." }, { status: 400 });
    }

    const { data: areFriends } = await supabase.rpc("users_are_friends", {
      p_user_id: user.id,
      p_other_id: otherId,
    });
    if (!areFriends) {
      return NextResponse.json(
        { error: "You can only message accepted friends." },
        { status: 403 }
      );
    }

    const conv = await createDirectConversation(supabase, user.id, otherId);
    if (!conv) {
      return NextResponse.json({ error: "Could not create conversation." }, { status: 500 });
    }
    return NextResponse.json({ conversationId: conv.id });
  }

  if (b.type === "group") {
    const title = typeof b.title === "string" ? b.title.trim() : "";
    if (title.length < 2 || title.length > 120) {
      return NextResponse.json(
        { error: "Group title must be 2–120 characters." },
        { status: 400 }
      );
    }

    const memberIds = Array.isArray(b.memberIds)
      ? b.memberIds.filter((id): id is string => typeof id === "string" && UUID_RE.test(id))
      : [];

    const uniqueMembers = [...new Set(memberIds)].filter((id) => id !== user.id);
    if (uniqueMembers.length < 1) {
      return NextResponse.json(
        { error: "Add at least one friend to the group." },
        { status: 400 }
      );
    }

    for (const memberId of uniqueMembers) {
      const { data: areFriends } = await supabase.rpc("users_are_friends", {
        p_user_id: user.id,
        p_other_id: memberId,
      });
      if (!areFriends) {
        return NextResponse.json(
          { error: "All group members must be your friends." },
          { status: 403 }
        );
      }
    }

    const courseId =
      typeof b.courseId === "string" && UUID_RE.test(b.courseId) ? b.courseId : null;

    const conv = await createGroupConversation(supabase, user.id, {
      title,
      memberIds: uniqueMembers,
      courseId,
    });
    if (!conv) {
      return NextResponse.json({ error: "Could not create group." }, { status: 500 });
    }

    return NextResponse.json({ conversationId: conv.id });
  }

  return NextResponse.json({ error: "Invalid conversation type." }, { status: 400 });
}
