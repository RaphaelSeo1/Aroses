import { NextResponse } from "next/server";
import { runLiveNotesWrapUp } from "@/lib/live-notes/run-notes-wrap-up";
import { syncLiveSessionToStandaloneNote } from "@/lib/live-notes/sync-standalone-note";
import {
  formatDeckForWrapUp,
  loadSessionDeckPages,
} from "@/lib/live-notes/slide-pages";
import { report } from "@/lib/report-error";
import { createRouteHandlerSupabase } from "@/lib/supabase/route-handler-client";
import { isUuid } from "@/lib/voice-tutor/uuid";

export const runtime = "nodejs";
export const maxDuration = 60;

type Params = { params: Promise<{ sessionId: string }> };

function formatTimestamp(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * POST /api/live-notes/[sessionId]/finish
 *
 * End a standalone-note capture: wrap-up review + lecture summary, sync notes
 * to user_notes, mark the session completed (no course build). Course live
 * lectures use .../complete instead.
 */
export async function POST(_request: Request, ctx: Params) {
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

  const { data: session } = await supabase
    .from("live_lecture_sessions")
    .select("id, user_id, user_note_id, status, title, notes_json, started_at, duration_seconds")
    .eq("id", sessionId)
    .maybeSingle();

  if (!session || session.user_id !== user.id) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (!session.user_note_id) {
    return NextResponse.json(
      { error: "This session is not linked to a standalone note." },
      { status: 409 }
    );
  }

  const noteId = session.user_note_id as string;

  if (session.status === "completed") {
    return NextResponse.json({
      redirect: `/notes/doc/${noteId}`,
    });
  }

  const title =
    typeof session.title === "string" && session.title.trim()
      ? session.title.trim()
      : "Live lecture";

  // Compose transcript + optional screen content for wrap-up (same shape as complete).
  const { data: segments } = await supabase
    .from("live_lecture_segments")
    .select("seq, text, at_ms")
    .eq("session_id", sessionId)
    .order("seq", { ascending: true })
    .limit(5_000);

  const body = (segments ?? [])
    .map((s) => `[${formatTimestamp(s.at_ms ?? 0)}] ${String(s.text).trim()}`)
    .join("\n");
  const transcriptOnly = `[from ${title} transcript]\n${body}`.slice(0, 500_000);

  let screenContent = "";
  try {
    const { data: screenRows, error: screenErr } = await supabase
      .from("live_lecture_screen_content")
      .select("seq, at_ms, title, extracted_text, table_markdown")
      .eq("session_id", sessionId)
      .order("seq", { ascending: true })
      .limit(200);
    if (!screenErr && screenRows) {
      const screenBlocks = screenRows
        .map((r) => {
          const stamp = formatTimestamp(r.at_ms ?? 0);
          const head =
            typeof r.title === "string" && r.title.trim()
              ? `[${stamp}] ${r.title.trim()}`
              : `[${stamp}]`;
          const text = String(r.extracted_text ?? "").trim();
          const table =
            typeof r.table_markdown === "string" && r.table_markdown.trim()
              ? `\n${r.table_markdown.trim()}`
              : "";
          return text || table ? `${head}\n${text}${table}` : null;
        })
        .filter((b): b is string => Boolean(b));
      screenContent = screenBlocks.join("\n\n").slice(0, 100_000);
    }
  } catch {
    /* migration not applied */
  }

  const deckContent = formatDeckForWrapUp(
    await loadSessionDeckPages(supabase, sessionId)
  );

  try {
    const next = await runLiveNotesWrapUp({
      notesJson: session.notes_json,
      transcript: transcriptOnly,
      screenContent: screenContent || undefined,
      deckContent: deckContent || undefined,
      lectureTitle: title,
      durationSeconds:
        typeof session.duration_seconds === "number"
          ? session.duration_seconds
          : null,
      startedAt:
        typeof session.started_at === "string" ? session.started_at : null,
      userId: user.id,
    });
    if (next !== session.notes_json) {
      await supabase
        .from("live_lecture_sessions")
        .update({
          notes_json: next,
          updated_at: new Date().toISOString(),
        })
        .eq("id", sessionId)
        .eq("user_id", user.id);
    }
  } catch (e) {
    void report("live-notes.standalone_wrapup_failed", e, {
      userId: user.id,
      detail: { sessionId },
    });
  }

  const synced = await syncLiveSessionToStandaloneNote(
    supabase,
    sessionId,
    user.id
  );

  await supabase
    .from("live_lecture_sessions")
    .update({
      status: "completed",
      ended_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId)
    .eq("user_id", user.id);

  return NextResponse.json({
    redirect: `/notes/doc/${synced?.noteId ?? noteId}`,
  });
}
