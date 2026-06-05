import { NextResponse } from "next/server";
import { enrichProfiles } from "@/lib/messaging/profiles";
import type { ConversationMember, FriendProfile } from "@/lib/messaging/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ conversationId: string }> };

/** GET — conversation metadata for thread header. */
export async function GET(_request: Request, ctx: Params) {
  const { conversationId } = await ctx.params;
  if (!UUID_RE.test(conversationId)) {
    return NextResponse.json({ error: "Invalid id." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const { data: allowed } = await supabase.rpc("is_conversation_participant", {
    p_conversation_id: conversationId,
    p_user_id: user.id,
  });
  if (!allowed) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  const { data: conv } = await supabase
    .from("conversations")
    .select("id, type, title, course_id")
    .eq("id", conversationId)
    .maybeSingle();

  if (!conv) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const { data: parts } = await supabase
    .from("conversation_participants")
    .select("user_id, role")
    .eq("conversation_id", conversationId);

  const memberRows = parts ?? [];
  const allUserIds = memberRows.map((p) => p.user_id);
  const others = allUserIds.filter((id) => id !== user.id);

  const admin = createAdminClient();
  const profileMap = await enrichProfiles(admin ?? supabase, allUserIds);

  function toProfile(id: string): FriendProfile {
    const p = profileMap.get(id);
    return {
      id,
      displayName: p?.displayName ?? null,
      username: p?.username ?? null,
      avatarUrl: p?.avatarUrl ?? null,
    };
  }

  const participants = others.map(toProfile);

  const members: ConversationMember[] = memberRows
    .map((row) => ({
      ...toProfile(row.user_id),
      role: row.role === "admin" ? ("admin" as const) : ("member" as const),
      isSelf: row.user_id === user.id,
    }))
    .sort((a, b) => {
      if (a.isSelf) return -1;
      if (b.isSelf) return 1;
      const aName = a.displayName ?? a.username ?? "";
      const bName = b.displayName ?? b.username ?? "";
      return aName.localeCompare(bName);
    });

  let courseTitle: string | null = null;
  if (conv.course_id) {
    const { data: course } = await supabase
      .from("courses")
      .select("title")
      .eq("id", conv.course_id)
      .maybeSingle();
    courseTitle = course?.title ?? null;
  }

  return NextResponse.json({
    conversation: {
      id: conv.id,
      type: conv.type,
      title: conv.title,
      courseId: conv.course_id,
      courseTitle,
      isGroup: conv.type === "group",
      participants,
      members: conv.type === "group" ? members : undefined,
    },
  });
}
