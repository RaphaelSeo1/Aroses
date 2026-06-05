import { NextResponse } from "next/server";
import { enrichProfiles } from "@/lib/messaging/profiles";
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
    .select("user_id")
    .eq("conversation_id", conversationId);

  const others = (parts ?? []).map((p) => p.user_id).filter((id) => id !== user.id);
  const profileMap = await enrichProfiles(supabase, others);
  const participants = others.map((id) => {
    const p = profileMap.get(id);
    return {
      id,
      displayName: p?.displayName ?? null,
      username: p?.username ?? null,
      avatarUrl: p?.avatarUrl ?? null,
    };
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
    },
  });
}
