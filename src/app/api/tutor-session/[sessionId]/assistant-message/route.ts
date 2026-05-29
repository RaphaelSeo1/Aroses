import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { TutorSessionMessage } from "@/types/tutor-session";

/**
 * POST /api/tutor-session/[sessionId]/assistant-message
 *
 * Appends a Rose (assistant) message to the transcript without a
 * matching user turn. Used for fixed inactivity check-ins.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ sessionId: string }> };

export async function POST(request: Request, ctx: Params) {
  const { sessionId } = await ctx.params;
  if (!UUID_RE.test(sessionId)) {
    return NextResponse.json({ error: "Invalid session id" }, { status: 400 });
  }

  let body: { content?: unknown };
  try {
    body = (await request.json()) as { content?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (content.length < 1) {
    return NextResponse.json({ error: "Empty content" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { data: sessionRow } = await supabase
    .from("tutor_sessions")
    .select("id, user_id, status, conversation_transcript")
    .eq("id", sessionId)
    .maybeSingle();
  if (!sessionRow || sessionRow.user_id !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (sessionRow.status === "ended") {
    return NextResponse.json({ error: "Session has ended" }, { status: 409 });
  }

  const history: TutorSessionMessage[] = Array.isArray(
    sessionRow.conversation_transcript
  )
    ? (sessionRow.conversation_transcript as TutorSessionMessage[])
    : [];

  const message: TutorSessionMessage = {
    role: "assistant",
    content: content.slice(0, 4000),
    ts: Date.now(),
  };

  const { error } = await supabase
    .from("tutor_sessions")
    .update({
      conversation_transcript: [...history, message],
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId)
    .eq("user_id", user.id);

  if (error) {
    console.error("[tutor-session assistant-message]", error);
    return NextResponse.json({ error: "Could not save message." }, { status: 500 });
  }

  console.log("[tutor-inactivity] assistant-message saved", {
    sessionId,
    length: content.length,
  });

  return NextResponse.json({ ok: true });
}
