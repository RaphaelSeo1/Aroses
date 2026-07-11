import { NextResponse } from "next/server";
import { clampNoteInstruction } from "@/lib/ai/note-instruction";
import { isNoteInstructionColumnError } from "@/lib/load-note-instruction";
import { createClient } from "@/lib/supabase/server";
import type {
  TutorSessionMessage,
  TutorSessionModeTag,
  TutorSessionRecord,
  TutorSessionUpload,
} from "@/types/tutor-session";

/**
 * GET    /api/tutor-session/[sessionId]
 *   Returns the full session record (including transcript + uploads).
 *   Used by the active-session client + recap view.
 *
 * PATCH  /api/tutor-session/[sessionId]
 *   Body: { title?: string, noteInstruction?: string } — rename the session
 *   and/or save the per-session note-style request.
 *
 * DELETE /api/tutor-session/[sessionId]
 *   Hard-deletes the session row. ON DELETE CASCADE on the uploads
 *   table + storage policy clean up child rows / files.
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

  const { data: sessionRow } = await supabase
    .from("tutor_sessions")
    .select("*")
    .eq("id", sessionId)
    .maybeSingle();
  if (!sessionRow || sessionRow.user_id !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: uploadRows } = await supabase
    .from("tutor_session_uploads")
    .select("id, file_name, file_kind, mime_type, size_bytes, summary, created_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });

  const uploads: TutorSessionUpload[] = (uploadRows ?? []).map((u) => ({
    id: u.id,
    fileName: u.file_name,
    fileKind: u.file_kind as TutorSessionUpload["fileKind"],
    mimeType: u.mime_type,
    sizeBytes: u.size_bytes,
    summary: u.summary,
    createdAt: u.created_at,
  }));

  const transcript: TutorSessionMessage[] = Array.isArray(
    sessionRow.conversation_transcript
  )
    ? (sessionRow.conversation_transcript as TutorSessionMessage[])
    : [];

  const record: TutorSessionRecord = {
    id: sessionRow.id,
    title: sessionRow.title,
    topic: sessionRow.topic,
    modeTag: (sessionRow.mode_tag as TutorSessionModeTag) || null,
    status: sessionRow.status,
    startedAt: sessionRow.started_at,
    endedAt: sessionRow.ended_at,
    durationSeconds: sessionRow.duration_seconds,
    referenceSummary: sessionRow.reference_summary ?? "",
    discussionSummary: sessionRow.discussion_summary ?? "",
    liveNotesJson: sessionRow.live_notes_json,
    liveNotesText: sessionRow.live_notes_text ?? "",
    recapMarkdown: sessionRow.recap_markdown,
    recapGeneratedAt: sessionRow.recap_generated_at,
    recapStatus: sessionRow.recap_status,
    // Pre-migration rows won't have the column on the `*` select — degrade
    // to the empty-string default.
    noteInstruction:
      typeof sessionRow.note_instruction === "string"
        ? sessionRow.note_instruction
        : "",
    createdAt: sessionRow.created_at,
    updatedAt: sessionRow.updated_at,
    uploads,
    transcript,
  };

  return NextResponse.json({ session: record });
}

export async function PATCH(request: Request, ctx: Params) {
  const { sessionId } = await ctx.params;
  if (!UUID_RE.test(sessionId)) {
    return NextResponse.json({ error: "Invalid session id" }, { status: 400 });
  }

  let body: { title?: unknown; noteInstruction?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (typeof body.title === "string" && body.title.trim()) {
    patch.title = body.title.trim().slice(0, 200);
  } else if (body.title !== undefined) {
    return NextResponse.json({ error: "title required" }, { status: 400 });
  }
  if (typeof body.noteInstruction === "string") {
    patch.note_instruction = clampNoteInstruction(body.noteInstruction);
  }
  if (!("title" in patch) && !("note_instruction" in patch)) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const runUpdate = (fields: Record<string, unknown>) =>
    supabase
      .from("tutor_sessions")
      .update(fields)
      .eq("id", sessionId)
      .eq("user_id", user.id)
      .select("id, title")
      .maybeSingle();

  let { data, error } = await runUpdate(patch);

  // Graceful pre-migration fallback: a missing note_instruction column must
  // never break a rename (and an instruction-only save becomes a no-op).
  if (
    error &&
    "note_instruction" in patch &&
    isNoteInstructionColumnError(error.message)
  ) {
    const { note_instruction: _ni, ...rest } = patch;
    ({ data, error } = await runUpdate(rest));
  }

  if (error || !data) {
    return NextResponse.json({ error: "Update failed" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, title: data.title });
}

export async function DELETE(_req: Request, ctx: Params) {
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

  // Best-effort: pull upload paths so we can wipe storage objects
  // alongside the DB row. If storage cleanup fails we still proceed
  // with the DB delete — orphans get cleaned by a future cron.
  const { data: uploads } = await supabase
    .from("tutor_session_uploads")
    .select("storage_path")
    .eq("session_id", sessionId);
  if (uploads && uploads.length > 0) {
    const paths = uploads.map((u) => u.storage_path).filter(Boolean);
    if (paths.length > 0) {
      await supabase.storage.from("tutor-session-uploads").remove(paths);
    }
  }

  const { error } = await supabase
    .from("tutor_sessions")
    .delete()
    .eq("id", sessionId)
    .eq("user_id", user.id);
  if (error) {
    console.error("[tutor-session DELETE]", error);
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
