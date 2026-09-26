import { NextResponse } from "next/server";
import { recordVoiceSeconds } from "@/lib/billing/voice-usage";
import { liveNotesToPlainText } from "@/lib/live-notes/notes-review";
import { runLiveNotesWrapUp } from "@/lib/live-notes/run-notes-wrap-up";
import { loadCanonicalLiveNoteSources } from "@/lib/live-notes/source-bundle";
import {
  formatDeckForWrapUp,
  loadSessionDeckPages,
} from "@/lib/live-notes/slide-pages";
import { report } from "@/lib/report-error";
import { loadNoteInstruction } from "@/lib/load-note-instruction";
import { createRouteHandlerSupabase } from "@/lib/supabase/route-handler-client";
import { isUuid } from "@/lib/voice-tutor/uuid";

export const runtime = "nodejs";
export const maxDuration = 120;

type Params = { params: Promise<{ sessionId: string }> };

/** Same `m:ss` timestamp format the audio-upload transcript path produces. */
function formatTimestamp(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * POST /api/live-notes/[sessionId]/complete
 *
 * Finish a course-attached lecture: wrap up the notes from the transcript,
 * slides, and on-screen extracts, meter remaining voice time, and mark the
 * session completed. Does not start a course build.
 *
 * Optional JSON body: `{ attachedPdfText?, attachedPdfName? }` — chat-attached
 * handout still sitting in the client's sessionStorage.
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

  let attachedPdfText = "";
  let attachedPdfName = "";
  try {
    const rawBody = await request.text();
    if (rawBody.trim()) {
      const parsed = JSON.parse(rawBody) as {
        attachedPdfText?: unknown;
        attachedPdfName?: unknown;
      };
      if (typeof parsed.attachedPdfText === "string") {
        attachedPdfText = parsed.attachedPdfText.trim().slice(0, 16_000);
      }
      if (typeof parsed.attachedPdfName === "string") {
        attachedPdfName = parsed.attachedPdfName.trim().slice(0, 200);
      }
    }
  } catch {
    /* empty / non-JSON body — notes + transcript + deck still pack */
  }

  const { data: session } = await supabase
    .from("live_lecture_sessions")
    .select(
      "id, user_id, course_id, exam_group_id, title, status, started_at, duration_seconds, metered_seconds, ingest_job_id, notes_json, notes_text"
    )
    .eq("id", sessionId)
    .maybeSingle();
  if (!session || session.user_id !== user.id) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  if (!session.course_id) {
    return NextResponse.json(
      {
        error:
          "This recording belongs to a standalone note. Use Stop recording.",
      },
      { status: 409 }
    );
  }

  const courseId = session.course_id as string;

  // ── Compose the transcript ────────────────────────────────────────────────
  const { data: segments, error: segErr } = await supabase
    .from("live_lecture_segments")
    .select("seq, text, at_ms")
    .eq("session_id", sessionId)
    .order("seq", { ascending: true })
    .limit(5_000);
  if (segErr) {
    console.error("[live-notes/complete] segments load", sessionId, segErr);
    return NextResponse.json(
      { error: "Could not load the transcript." },
      { status: 500 }
    );
  }

  const title =
    typeof session.title === "string" && session.title.trim()
      ? session.title.trim()
      : "Live lecture";

  const body = (segments ?? [])
    .map((s) => `[${formatTimestamp(s.at_ms ?? 0)}] ${String(s.text).trim()}`)
    .join("\n");
  // Same attribution shape the audio-upload extractor produces.
  const transcriptOnly = `[from ${title} transcript]\n${body}`.slice(0, 500_000);

  // Optional on-screen extracts (slide vision) — second factual source.
  // Table may be missing until migration 084 is applied.
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
      screenContent = screenBlocks.join("\n\n").slice(0, 200_000);
    }
  } catch {
    /* migration not applied — continue without screen extracts */
  }

  const deckPages = await loadSessionDeckPages(supabase, sessionId);
  const deckForWrapUp = formatDeckForWrapUp(deckPages);
  const canonicalSources = await loadCanonicalLiveNoteSources(
    supabase,
    sessionId
  );
  if (
    attachedPdfText.length >= 12 &&
    (canonicalSources.materials ?? []).length === 0
  ) {
    const name = attachedPdfName || "Attached course material";
    const materials = canonicalSources.materials ?? [];
    if (
      !materials.some(
        (material) =>
          material.name === name && material.text === attachedPdfText
      )
    ) {
      canonicalSources.materials = [
        ...materials,
        { name, text: attachedPdfText },
      ];
    }
  }
  if (
    (canonicalSources.materials ?? []).reduce(
      (sum, material) => sum + material.text.length,
      0
    ) > 80_000
  ) {
    canonicalSources.complete = false;
    canonicalSources.incompleteReasons = [
      ...(canonicalSources.incompleteReasons ?? []),
      "uploaded material character limit exceeded",
    ];
  }
  const noteInstruction = await loadNoteInstruction(
    supabase,
    "live_lecture_sessions",
    { id: sessionId, user_id: user.id }
  );

  // ── Wrap-up: canonical source synthesis + lecture summary ───────────────
  // Rebuild the editable AI draft from all sources, then generate a grounded
  // recap. Best effort: any failure leaves the notes as-is.
  let notesJson: unknown = session.notes_json;
  try {
    const next = await runLiveNotesWrapUp({
      notesJson,
      transcript: canonicalSources.transcript || transcriptOnly,
      screenContent: canonicalSources.screen || screenContent || undefined,
      deckContent: canonicalSources.deck || deckForWrapUp || undefined,
      materials: canonicalSources.materials,
      sourcesComplete: canonicalSources.complete,
      sourceIncompleteReasons: canonicalSources.incompleteReasons,
      lectureTitle: title,
      noteInstruction: noteInstruction || undefined,
      durationSeconds:
        typeof session.duration_seconds === "number"
          ? session.duration_seconds
          : null,
      startedAt:
        typeof session.started_at === "string" ? session.started_at : null,
      userId: user.id,
    });
    if (next !== notesJson) {
      notesJson = next;
      const { error: notesErr } = await supabase
        .from("live_lecture_sessions")
        .update({
          notes_json: notesJson,
          notes_text: liveNotesToPlainText(notesJson),
          updated_at: new Date().toISOString(),
        })
        .eq("id", sessionId)
        .eq("user_id", user.id);
      if (notesErr) notesJson = session.notes_json;
    }
  } catch (e) {
    notesJson = session.notes_json;
    void report("live-notes.wrapup_review_failed", e, {
      userId: user.id,
      detail: { sessionId },
    });
  }

  // ── Meter the un-metered tail of Deepgram seconds ────────────────────────
  const durationSeconds =
    typeof session.duration_seconds === "number" ? session.duration_seconds : 0;
  const meteredSeconds =
    typeof session.metered_seconds === "number" ? session.metered_seconds : 0;
  const unmetered = durationSeconds - meteredSeconds;
  if (unmetered > 0) {
    await recordVoiceSeconds(user.id, unmetered);
  }

  const { error: sessionErr } = await supabase
    .from("live_lecture_sessions")
    .update({
      status: "completed",
      ended_at: new Date().toISOString(),
      metered_seconds: Math.max(durationSeconds, meteredSeconds),
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId)
    .eq("user_id", user.id);
  if (sessionErr) {
    void report("live-notes.session_close_failed", sessionErr, {
      userId: user.id,
      detail: { sessionId },
    });
    return NextResponse.json(
      { error: "Could not finish this lecture." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    redirect: `/dashboard/courses/${courseId}`,
  });
}
