import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ conversationId: string }> };

/** PATCH — mark conversation read. */
export async function PATCH(_request: Request, ctx: Params) {
  const { conversationId } = await ctx.params;
  if (!UUID_RE.test(conversationId)) {
    return NextResponse.json({ error: "Invalid id." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("conversation_participants")
    .update({ last_read_at: now })
    .eq("conversation_id", conversationId)
    .eq("user_id", user.id);

  if (error) {
    console.error("[conversations read PATCH]", error);
    return NextResponse.json({ error: "Could not mark read." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
