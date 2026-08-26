import { NextResponse } from "next/server";
import { recordVoiceSeconds } from "@/lib/billing/voice-usage";
import {
  buildLiveNotesStudyContext,
  extractLiveNotesEmphasis,
} from "@/lib/live-notes/notes-emphasis";
import { runLiveNotesWrapUp } from "@/lib/live-notes/run-notes-wrap-up";
import {
  formatDeckForWrapUp,
  loadSessionDeckPages,
} from "@/lib/live-notes/slide-pages";
import { report } from "@/lib/report-error";
import { createAdminClient } from "@/lib/supabase/admin";
import { createRouteHandlerSupabase } from "@/lib/supabase/route-handler-client";
import { isMissingDbColumnError } from "@/lib/supabase/schema-compat";
import { STUDY_PDF_INGEST_BUCKET } from "@/lib/study-pdf-ingest";
import { isUuid } from "@/lib/voice-tutor/uuid";

export const runtime = "nodejs";
export const maxDuration = 90;

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
 * Wrap-up handoff: compose the lecture transcript from stored segments,
 * upload it to the ingest bucket as a `.txt` (satisfies the job table's
 * `storage_path NOT NULL` and makes the existing retry route work), then
 * insert a `pdf_ingest_jobs` row parked at `reviewing_transcript` — exactly
 * the state an audio upload reaches after Whisper. The client redirects to
 * the existing build page, where `TranscriptReviewPanel` lets the student
 * review/edit before `confirm-transcript` runs the unmodified generation
 * pipeline.
 *
 * Idempotent: a second call on a completed session returns the same jobId.
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
    .select(
      "id, user_id, course_id, exam_group_id, title, status, started_at, duration_seconds, metered_seconds, ingest_job_id, notes_json"
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
          "This recording belongs to a standalone note. Use Stop recording instead of building a course here.",
      },
      { status: 409 }
    );
  }

  const courseId = session.course_id as string;

  if (session.status === "completed" && session.ingest_job_id) {
    return NextResponse.json({
      jobId: session.ingest_job_id,
      redirect: `/dashboard/courses/${courseId}/study/build?pdfJobs=${session.ingest_job_id}`,
    });
  }
  if (session.status === "failed") {
    return NextResponse.json(
      { error: "This session already failed. Start a new recording." },
      { status: 409 }
    );
  }

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
      screenContent = screenBlocks.join("\n\n").slice(0, 100_000);
    }
  } catch {
    /* migration not applied — transcript-only wrap-up */
  }

  const deckContent = formatDeckForWrapUp(
    await loadSessionDeckPages(supabase, sessionId)
  );

  // Combined ingest blob: screen first (spellings/numbers), then uploaded
  // deck, then transcript.
  const transcript = (
    [
      screenContent ? `[from ${title} screen]\n${screenContent}` : null,
      deckContent ? `[from ${title} slides]\n${deckContent}` : null,
      transcriptOnly,
    ]
      .filter(Boolean)
      .join("\n\n")
  ).slice(0, 500_000);

  // Mirrors the confirm-transcript minimum — below this, generation would
  // silently no-op, so reject with something actionable instead.
  if (body.trim().length < 80) {
    return NextResponse.json(
      {
        error:
          "Not enough speech was captured to build a course yet. Keep recording a bit longer, or check that the right audio source is being shared.",
      },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json(
      {
        error:
          "Server is not configured for storage. Set SUPABASE_SERVICE_ROLE_KEY on the host, then redeploy.",
      },
      { status: 500 }
    );
  }

  // ── Resolve the exam group (job column is NOT NULL) ─────────────────────
  let examGroupId =
    typeof session.exam_group_id === "string" ? session.exam_group_id : null;
  if (!examGroupId) {
    const { data: firstGroup } = await supabase
      .from("exam_groups")
      .select("id")
      .eq("course_id", courseId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    examGroupId = firstGroup?.id ?? null;
  }
  if (!examGroupId) {
    const { data: created } = await supabase
      .from("exam_groups")
      .insert({
        course_id: courseId,
        user_id: user.id,
        name: "My materials",
        sort_order: 0,
      })
      .select("id")
      .maybeSingle();
    examGroupId = created?.id ?? null;
  }
  if (!examGroupId) {
    return NextResponse.json(
      { error: "Could not find a section for this course." },
      { status: 500 }
    );
  }

  // ── Upload the composed transcript as the job's storage object ──────────
  // `{userId}/{uuid}.txt` matches the ingest path contract, so retry /
  // failure-cleanup paths that download or remove the object work unchanged.
  const storagePath = `${user.id}/${crypto.randomUUID()}.txt`;
  const { error: uploadErr } = await admin.storage
    .from(STUDY_PDF_INGEST_BUCKET)
    .upload(storagePath, new Blob([transcript], { type: "text/plain" }), {
      contentType: "text/plain",
      upsert: false,
    });
  if (uploadErr) {
    console.error("[live-notes/complete] transcript upload", sessionId, uploadErr);
    void report("live-notes.transcript_upload_failed", uploadErr, {
      userId: user.id,
      detail: { sessionId },
    });
    return NextResponse.json(
      { error: "Could not save the transcript file." },
      { status: 500 }
    );
  }

  // ── Course output language (same source the upload form uses) ───────────
  const { data: courseRow } = await supabase
    .from("courses")
    .select("output_language")
    .eq("id", courseId)
    .maybeSingle();
  const outputLanguage =
    typeof courseRow?.output_language === "string" &&
    courseRow.output_language.trim()
      ? courseRow.output_language.trim()
      : null;

  const { count: existingMaterialCount } = await supabase
    .from("study_materials")
    .select("id", { count: "exact", head: true })
    .eq("exam_group_id", examGroupId);

  // ── Wrap-up: consistency review + lecture summary ───────────────────────
  // One Haiku pass verifies AI note sections, then prepends a grounded
  // "## Lecture summary" for exam-morning review. Best effort: any failure
  // leaves the notes as-is and generation proceeds.
  let notesJson: unknown = session.notes_json;
  try {
    const next = await runLiveNotesWrapUp({
      notesJson,
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
    if (next !== notesJson) {
      notesJson = next;
      const { error: notesErr } = await supabase
        .from("live_lecture_sessions")
        .update({ notes_json: notesJson, updated_at: new Date().toISOString() })
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

  // ── Three-input weighting (v2) ───────────────────────────────────────────
  // Student-authored/edited note blocks + the AI-notes heading outline flow
  // into `study_context`, which every outline/module prompt already renders
  // as learner context. Emphasis only — the transcript stays the sole
  // factual source.
  const emphasis = extractLiveNotesEmphasis(notesJson);
  const studyContext = buildLiveNotesStudyContext({
    emphasis,
    lectureTitle: title,
  });

  // ── Insert the job parked at reviewing_transcript ────────────────────────
  // Same recoverable state audio uploads reach after Whisper: the reaper
  // leaves it alone, and confirm-transcript drives the unmodified pipeline.
  const jobInsert: Record<string, unknown> = {
    user_id: user.id,
    course_id: courseId,
    exam_group_id: examGroupId,
    storage_path: storagePath,
    original_file_name: `${title}.txt`,
    status: "running",
    ingest_phase: "reviewing_transcript",
    ingest_transcript: transcript,
    source_format: "text",
    material_sort_order: existingMaterialCount ?? 0,
    ...(outputLanguage ? { output_language: outputLanguage } : {}),
    ...(studyContext ? { study_context: studyContext } : {}),
  };

  let { data: jobRow, error: jobErr } = await admin
    .from("pdf_ingest_jobs")
    .insert(jobInsert as never)
    .select("id")
    .single();

  // Older databases may lack the optional context columns — retry without.
  if (
    jobErr &&
    isMissingDbColumnError(
      jobErr,
      "study_context",
      "material_sort_order",
      "output_language"
    )
  ) {
    const minimal = { ...jobInsert };
    delete minimal.study_context;
    delete minimal.material_sort_order;
    delete minimal.output_language;
    ({ data: jobRow, error: jobErr } = await admin
      .from("pdf_ingest_jobs")
      .insert(minimal as never)
      .select("id")
      .single());
  }

  if (jobErr || !jobRow) {
    console.error("[live-notes/complete] job insert", sessionId, jobErr);
    await admin.storage
      .from(STUDY_PDF_INGEST_BUCKET)
      .remove([storagePath])
      .catch(() => {});
    void report("live-notes.job_insert_failed", jobErr ?? "no row", {
      userId: user.id,
      detail: { sessionId },
    });
    const migrationHint = isMissingDbColumnError(
      jobErr,
      "ingest_phase",
      "ingest_transcript",
      "source_format",
      "material_sort_order",
      "output_language"
    )
      ? " Apply migrations 027, 039, and 040 in Supabase, then try again."
      : "";
    return NextResponse.json(
      { error: `Could not start the course build.${migrationHint}` },
      { status: 500 }
    );
  }

  const jobId = jobRow.id as string;

  // ── Meter the un-metered tail of Deepgram seconds ────────────────────────
  const durationSeconds =
    typeof session.duration_seconds === "number" ? session.duration_seconds : 0;
  const meteredSeconds =
    typeof session.metered_seconds === "number" ? session.metered_seconds : 0;
  const unmetered = durationSeconds - meteredSeconds;
  if (unmetered > 0) {
    await recordVoiceSeconds(user.id, unmetered);
  }

  // ── Close out the session ────────────────────────────────────────────────
  const { error: sessionErr } = await supabase
    .from("live_lecture_sessions")
    .update({
      status: "completed",
      ended_at: new Date().toISOString(),
      ingest_job_id: jobId,
      metered_seconds: Math.max(durationSeconds, meteredSeconds),
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId)
    .eq("user_id", user.id);
  if (sessionErr) {
    // Job exists and is recoverable via the build page; just surface the gap.
    void report("live-notes.session_close_failed", sessionErr, {
      userId: user.id,
      detail: { sessionId, jobId },
    });
  }

  return NextResponse.json({
    jobId,
    redirect: `/dashboard/courses/${courseId}/study/build?pdfJobs=${jobId}&section=${examGroupId}`,
  });
}
