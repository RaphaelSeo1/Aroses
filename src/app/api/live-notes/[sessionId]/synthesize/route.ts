import { NextResponse } from "next/server";
import { synthesizeLiveLectureNotes } from "@/lib/ai/live-lecture-notes";
import { report } from "@/lib/report-error";
import { createRouteHandlerSupabase } from "@/lib/supabase/route-handler-client";
import { isUuid } from "@/lib/voice-tutor/uuid";

export const runtime = "nodejs";
export const maxDuration = 60;

type Params = { params: Promise<{ sessionId: string }> };

const MAX_INPUT_CHARS = 12_000;
/** Hard per-session cap on Haiku note-append calls (runaway guard). */
const MAX_SYNTHESIZE_CALLS = 60;

/**
 * POST /api/live-notes/[sessionId]/synthesize
 *
 * Turn the newest slice of live transcript into one structured notes block.
 * Body: { newSegmentText, recentHeadings?: string[] }
 * → { block: AutoGenerateBlock | null, updatedSummary }
 *
 * The rolling summary is loaded from and persisted to the session row here
 * (never trusted from the client), so a reload resumes cleanly and the
 * model input stays bounded on any lecture length.
 */
export async function POST(request: Request, ctx: Params) {
  const { sessionId } = await ctx.params;
  if (!isUuid(sessionId)) {
    return NextResponse.json({ error: "Invalid session id" }, { status: 400 });
  }

  const supabase = await createRouteHandlerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const b = body as { newSegmentText?: unknown; recentHeadings?: unknown };
  if (typeof b.newSegmentText !== "string" || !b.newSegmentText.trim()) {
    return NextResponse.json({ error: "newSegmentText required" }, { status: 400 });
  }
  const recentHeadings = Array.isArray(b.recentHeadings)
    ? b.recentHeadings
        .filter((h): h is string => typeof h === "string" && h.trim().length > 0)
        .slice(-5)
    : [];

  const { data: session } = await supabase
    .from("live_lecture_sessions")
    .select("id, title, status, rolling_summary, synthesize_calls")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (session.status === "completed" || session.status === "failed") {
    return NextResponse.json({ error: "This session has ended." }, { status: 409 });
  }

  const calls =
    typeof session.synthesize_calls === "number" ? session.synthesize_calls : 0;
  if (calls >= MAX_SYNTHESIZE_CALLS) {
    // Transcript capture keeps working; only the AI note appends stop.
    return NextResponse.json({
      block: null,
      updatedSummary: session.rolling_summary ?? "",
      capped: true,
    });
  }

  // Count the attempt before the model call so a crash mid-call still burns
  // one slot — the guard is about bounding spend, not exact accounting.
  await supabase
    .from("live_lecture_sessions")
    .update({
      synthesize_calls: calls + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId)
    .eq("user_id", user.id);

  const result = await synthesizeLiveLectureNotes({
    newSegmentText: b.newSegmentText.slice(0, MAX_INPUT_CHARS),
    rollingSummary:
      typeof session.rolling_summary === "string" ? session.rolling_summary : "",
    recentHeadings,
    lectureTitle: typeof session.title === "string" ? session.title : undefined,
    userId: user.id,
  });

  if (!result) {
    void report("live-notes.synthesize_failed", "model call or parse failed", {
      userId: user.id,
      detail: { sessionId },
    });
    return NextResponse.json(
      { error: "Could not synthesize notes for this slice." },
      { status: 502 }
    );
  }

  if (result.updatedSummary !== session.rolling_summary) {
    await supabase
      .from("live_lecture_sessions")
      .update({
        rolling_summary: result.updatedSummary,
        updated_at: new Date().toISOString(),
      })
      .eq("id", sessionId)
      .eq("user_id", user.id);
  }

  return NextResponse.json({
    block: result.block,
    updatedSummary: result.updatedSummary,
  });
}
