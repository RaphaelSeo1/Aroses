import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateRecap } from "@/lib/ai/tutor-session";
import type {
  TutorSessionMessage,
  TutorSessionModeTag,
} from "@/types/tutor-session";

/**
 * GET  /api/tutor-session/[sessionId]/recap
 *   Returns the current recap state. Used by the recap view to
 *   poll while a generation is in flight (status='generating') and
 *   when displaying a ready recap.
 *
 * POST /api/tutor-session/[sessionId]/recap
 *   Regenerates the recap. Triggered by the "Regenerate" button on
 *   the recap view when a previous attempt failed. Same logic as
 *   the end-of-session generator.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ sessionId: string }> };

export async function GET(_req: Request, ctx: Params) {
  const { sessionId } = await ctx.params;
  if (!UUID_RE.test(sessionId)) {
    return NextResponse.json({ error: "Invalid session id" }, { status: 400 });
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const { data } = await supabase
    .from("tutor_sessions")
    .select(
      "id, user_id, title, mode_tag, duration_seconds, started_at, ended_at, recap_markdown, recap_status, recap_generated_at"
    )
    .eq("id", sessionId)
    .maybeSingle();
  if (!data || data.user_id !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({
    title: data.title,
    modeTag: data.mode_tag,
    durationSeconds: data.duration_seconds,
    startedAt: data.started_at,
    endedAt: data.ended_at,
    recapMarkdown: data.recap_markdown,
    recapStatus: data.recap_status,
    recapGeneratedAt: data.recap_generated_at,
  });
}

export async function POST(_req: Request, ctx: Params) {
  const { sessionId } = await ctx.params;
  if (!UUID_RE.test(sessionId)) {
    return NextResponse.json({ error: "Invalid session id" }, { status: 400 });
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
    .select(
      "id, user_id, title, mode_tag, started_at, duration_seconds, conversation_transcript, reference_summary, live_notes_text"
    )
    .eq("id", sessionId)
    .maybeSingle();
  if (!sessionRow || sessionRow.user_id !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const transcript: TutorSessionMessage[] = Array.isArray(
    sessionRow.conversation_transcript
  )
    ? (sessionRow.conversation_transcript as TutorSessionMessage[])
    : [];

  await supabase
    .from("tutor_sessions")
    .update({ recap_status: "generating", updated_at: new Date().toISOString() })
    .eq("id", sessionId)
    .eq("user_id", user.id);

  try {
    const recap = await generateRecap({
      title: sessionRow.title,
      modeTag: (sessionRow.mode_tag as TutorSessionModeTag) || null,
      durationSeconds: sessionRow.duration_seconds,
      startedAt: sessionRow.started_at,
      transcript,
      referenceSummary: sessionRow.reference_summary ?? "",
      liveNotesText: sessionRow.live_notes_text ?? "",
    });
    await supabase
      .from("tutor_sessions")
      .update({
        recap_markdown: recap,
        recap_generated_at: new Date().toISOString(),
        recap_status: "ready",
        updated_at: new Date().toISOString(),
      })
      .eq("id", sessionId)
      .eq("user_id", user.id);
    return NextResponse.json({ recapStatus: "ready", recapMarkdown: recap });
  } catch (e) {
    console.error("[tutor-session/recap regenerate]", e);
    await supabase
      .from("tutor_sessions")
      .update({
        recap_status: "failed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", sessionId)
      .eq("user_id", user.id);
    return NextResponse.json({ recapStatus: "failed" });
  }
}
