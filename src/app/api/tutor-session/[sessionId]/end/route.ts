import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logActivity } from "@/lib/activity-log";
import { generateRecap } from "@/lib/ai/tutor-session";
import type {
  TutorSessionMessage,
  TutorSessionModeTag,
} from "@/types/tutor-session";

/**
 * POST /api/tutor-session/[sessionId]/end
 *
 * Marks a session as `ended`, computes its duration, and kicks off
 * recap generation. The recap call runs INLINE here rather than
 * in a background worker — typical recap calls take 8-20s with
 * Claude Sonnet so the client just shows a "Rose is putting your
 * recap together…" state until this endpoint returns.
 *
 * Response: { recapStatus: "ready" | "failed", recapMarkdown? }
 *
 * If generation fails (network blip, Anthropic 5xx), we mark
 * recap_status='failed' and return so the client can offer a retry
 * via POST /api/tutor-session/[sessionId]/recap.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ sessionId: string }> };

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
      "id, user_id, title, mode_tag, started_at, conversation_transcript, reference_summary, live_notes_text, status"
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

  const startedAt = new Date(sessionRow.started_at);
  const endedAt = new Date();
  const durationSeconds = Math.max(
    0,
    Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000)
  );

  // 1. Mark ended + recap_status='generating' upfront so concurrent
  //    list reads show the right state.
  await supabase
    .from("tutor_sessions")
    .update({
      status: "ended",
      ended_at: endedAt.toISOString(),
      duration_seconds: durationSeconds,
      recap_status: "generating",
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId)
    .eq("user_id", user.id);

  await logActivity({
    userId: user.id,
    type: "voice_tutor_ended",
    summary: sessionRow.title || "Tutor session",
    metadata: { sessionId, durationSeconds },
  });

  // Bypass recap entirely if the session was empty.
  if (transcript.length < 2) {
    await supabase
      .from("tutor_sessions")
      .update({ recap_status: "idle", updated_at: new Date().toISOString() })
      .eq("id", sessionId)
      .eq("user_id", user.id);
    return NextResponse.json({ recapStatus: "idle" });
  }

  // 2. Generate the recap. Single attempt — failures surface and
  //    the client can retry via the regenerate endpoint.
  try {
    const recap = await generateRecap({
      title: sessionRow.title || "Tutor session",
      modeTag: (sessionRow.mode_tag as TutorSessionModeTag) || null,
      durationSeconds,
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
    console.error("[tutor-session/end recap]", e);
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
