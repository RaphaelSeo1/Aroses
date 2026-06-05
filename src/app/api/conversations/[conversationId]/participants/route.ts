import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ conversationId: string }> };

/** POST — add a friend to a group thread. */
export async function POST(request: Request, ctx: Params) {
  const { conversationId } = await ctx.params;
  if (!UUID_RE.test(conversationId)) {
    return NextResponse.json({ error: "Invalid id." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const { data: conv } = await supabase
    .from("conversations")
    .select("id, type, created_by")
    .eq("id", conversationId)
    .maybeSingle();

  if (!conv || conv.type !== "group") {
    return NextResponse.json({ error: "Not a group conversation." }, { status: 400 });
  }

  const { data: selfPart } = await supabase
    .from("conversation_participants")
    .select("role")
    .eq("conversation_id", conversationId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!selfPart || (selfPart.role !== "admin" && conv.created_by !== user.id)) {
    return NextResponse.json({ error: "Only admins can add members." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const userId = (body as { userId?: unknown }).userId;
  if (typeof userId !== "string" || !UUID_RE.test(userId)) {
    return NextResponse.json({ error: "Invalid user id." }, { status: 400 });
  }

  const { data: areFriends } = await supabase.rpc("users_are_friends", {
    p_user_id: user.id,
    p_other_id: userId,
  });
  if (!areFriends) {
    return NextResponse.json({ error: "Can only add friends." }, { status: 403 });
  }

  const admin = createAdminClient();
  const writer = admin ?? supabase;

  const { error } = await writer.from("conversation_participants").upsert(
    {
      conversation_id: conversationId,
      user_id: userId,
      role: "member",
    },
    { onConflict: "conversation_id,user_id" }
  );

  if (error) {
    console.error("[participants POST]", error);
    return NextResponse.json({ error: "Could not add member." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
