import { NextResponse } from "next/server";
import { synthesizeTutorNotes } from "@/lib/ai/synthesize-tutor-notes";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/tutor-session/[sessionId]/synthesize-notes
 *
 * Turns Rose's spoken reply into structured study notes (not a transcript).
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ sessionId: string }> };

export async function POST(request: Request, ctx: Params) {
  const { sessionId } = await ctx.params;
  if (!UUID_RE.test(sessionId)) {
    return NextResponse.json({ error: "Invalid session id" }, { status: 400 });
  }

  let body: {
    roseReply?: unknown;
    studentUtterance?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const roseReply =
    typeof body.roseReply === "string" ? body.roseReply.trim() : "";
  if (roseReply.length < 20) {
    return NextResponse.json({ error: "roseReply too short" }, { status: 400 });
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
    .select("id, user_id, topic, mode_tag, status")
    .eq("id", sessionId)
    .maybeSingle();

  if (!sessionRow || sessionRow.user_id !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (sessionRow.status === "ended") {
    return NextResponse.json({ error: "Session has ended" }, { status: 409 });
  }

  const studentUtterance =
    typeof body.studentUtterance === "string"
      ? body.studentUtterance.trim()
      : undefined;

  console.log("[synthesize-notes] request", {
    sessionId,
    roseLen: roseReply.length,
    hasStudent: Boolean(studentUtterance),
  });

  const block = await synthesizeTutorNotes({
    roseReply,
    studentUtterance,
    sessionTopic: sessionRow.topic ?? "",
    modeTag: (sessionRow.mode_tag as string | null) ?? null,
  });

  if (!block) {
    return NextResponse.json(
      { error: "Could not synthesize notes." },
      { status: 500 }
    );
  }

  return NextResponse.json({ block });
}
