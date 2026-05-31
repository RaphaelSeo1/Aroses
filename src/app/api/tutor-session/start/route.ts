import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  generateSessionTitle,
} from "@/lib/ai/tutor-session";
import {
  extractTutorSessionUpload,
} from "@/lib/tutor-session/extract-upload";
import {
  TUTOR_SESSION_MAX_FILES,
  TUTOR_SESSION_MAX_TOTAL_BYTES,
} from "@/lib/tutor-session/upload-limits";
import { detectIngestFormat } from "@/lib/study-ingest/formats";
import { logActivity } from "@/lib/activity-log";
import type {
  TutorSessionModeTag,
  TutorSessionRecord,
  TutorSessionUpload,
} from "@/types/tutor-session";

/**
 * POST /api/tutor-session/start
 *
 * Creates a new tutor session. Accepts MULTIPART form data so the
 * student can optionally attach reference files (PDFs, images) at
 * session start. Body fields:
 *   - topic?:   string (the free-text topic the student typed)
 *   - modeTag?: TutorSessionModeTag (one of the chip values)
 *   - files?:   multiple File entries under the `files` key
 *
 * Pipeline:
 *   1. Auth.
 *   2. Insert empty session row (`active`, empty transcript).
 *   3. For each uploaded file:
 *        - Upload to `tutor-session-uploads/{userId}/{sessionId}/{name}`
 *        - PDF: extract text with pdf-parse, summarize via Haiku.
 *        - Image: base64 → Claude vision summary.
 *        - Insert `tutor_session_uploads` row.
 *   4. Concatenate per-file summaries → `reference_summary` on the
 *      session row.
 *   5. Generate a short session `title` via Haiku.
 *   6. Return the session record (with uploads) to the client.
 *
 * The whole pipeline runs in-line — typically 1-5s depending on
 * upload count. The client shows a "preparing your session" state.
 * Acceptable: students explicitly chose to upload before starting,
 * so a short wait is expected.
 */

const MAX_FILES = TUTOR_SESSION_MAX_FILES;
const MAX_TOTAL_BYTES = TUTOR_SESSION_MAX_TOTAL_BYTES;

function isModeTag(v: unknown): v is TutorSessionModeTag {
  return (
    v === "exam_prep" ||
    v === "homework_help" ||
    v === "concept_review" ||
    v === "quiz_me" ||
    v === "exploring"
  );
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Expected multipart/form-data" },
      { status: 400 }
    );
  }

  const topic = (form.get("topic") as string | null)?.toString().trim() ?? "";
  const modeRaw = form.get("modeTag");
  const modeTag = isModeTag(modeRaw) ? modeRaw : null;

  const fileEntries = form.getAll("files").filter((f): f is File => f instanceof File);
  if (fileEntries.length > MAX_FILES) {
    return NextResponse.json(
      { error: `At most ${MAX_FILES} files at a time.` },
      { status: 400 }
    );
  }
  let totalBytes = 0;
  for (const f of fileEntries) {
    if (!detectIngestFormat(f.name, f.type)) {
      return NextResponse.json(
        { error: `Unsupported file type: ${f.name}` },
        { status: 400 }
      );
    }
    totalBytes += f.size;
  }
  if (totalBytes > MAX_TOTAL_BYTES) {
    return NextResponse.json(
      { error: "Combined upload exceeds 200MB." },
      { status: 413 }
    );
  }

  // 1. Insert the session row first so we have a UUID to namespace
  //    uploads under.
  const initialTitle = topic
    ? topic.slice(0, 80)
    : modeTag
      ? `${modeTag.replace(/_/g, " ")} session`
      : "Tutor session";
  const { data: sessionRow, error: insertError } = await supabase
    .from("tutor_sessions")
    .insert({
      user_id: user.id,
      title: initialTitle,
      topic,
      mode_tag: modeTag,
      status: "active",
    })
    .select("*")
    .single();
  if (insertError || !sessionRow) {
    console.error("[tutor-session/start insert]", insertError);
    return NextResponse.json(
      { error: "Failed to create session" },
      { status: 500 }
    );
  }

  // 2. Process uploads sequentially. Sequential keeps the
  //    Anthropic/Supabase load smooth + makes error paths simple.
  const uploadSummaries: string[] = [];
  const insertedUploads: TutorSessionUpload[] = [];
  for (const file of fileEntries) {
    const buf = Buffer.from(await file.arrayBuffer());
    const mime = file.type || "application/octet-stream";
    const formatKind = detectIngestFormat(file.name, mime);
    if (!formatKind) continue;

    const fileKind: "pdf" | "image" | "text" =
      formatKind === "pdf"
        ? "pdf"
        : formatKind === "image"
          ? "image"
          : "text";

    const safeName = file.name.replace(/[^\w.\-]+/g, "_").slice(0, 120);
    const storagePath = `${user.id}/${sessionRow.id}/${Date.now()}-${safeName}`;
    const { error: storageError } = await supabase.storage
      .from("tutor-session-uploads")
      .upload(storagePath, buf, {
        contentType: mime,
        upsert: false,
      });
    if (storageError) {
      console.error("[tutor-session/start storage]", storageError);
      continue;
    }

    let extractedContent = "";
    let summary = "";
    try {
      const result = await extractTutorSessionUpload({
        buffer: buf,
        fileName: file.name,
        mimeType: mime,
      });
      extractedContent = result.extractedContent;
      summary = result.summary;
    } catch (e) {
      console.error("[tutor-session/start extract]", e);
      continue;
    }

    const { data: uploadRow } = await supabase
      .from("tutor_session_uploads")
      .insert({
        session_id: sessionRow.id,
        user_id: user.id,
        file_name: file.name,
        file_kind: fileKind,
        mime_type: mime,
        size_bytes: file.size,
        storage_path: storagePath,
        extracted_content: extractedContent,
        summary,
      })
      .select("id, file_name, file_kind, mime_type, size_bytes, summary, created_at")
      .single();
    if (uploadRow) {
      uploadSummaries.push(`[${uploadRow.file_name}] ${summary}`);
      insertedUploads.push({
        id: uploadRow.id,
        fileName: uploadRow.file_name,
        fileKind: uploadRow.file_kind as "pdf" | "image" | "text",
        mimeType: uploadRow.mime_type,
        sizeBytes: uploadRow.size_bytes,
        summary: uploadRow.summary,
        createdAt: uploadRow.created_at,
      });
    }
  }

  // 3. Roll the per-file summaries into a single reference_summary
  //    blob. Cap at ~6k chars to keep system prompts reasonable.
  const referenceSummary = uploadSummaries.join("\n\n").slice(0, 6000);

  // 4. Generate the canonical title (cheap Haiku call). If the topic
  //    is empty and there's nothing to summarize, the helper returns
  //    a sensible fallback.
  const title = await generateSessionTitle({
    topic,
    referenceSummary,
    modeTag,
  });

  // 5. Update the row with the polished title + reference summary.
  await supabase
    .from("tutor_sessions")
    .update({
      title,
      reference_summary: referenceSummary,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionRow.id)
    .eq("user_id", user.id);

  await logActivity({
    userId: user.id,
    type: "voice_tutor_started",
    summary: title || topic || "Tutor session",
    metadata: { sessionId: sessionRow.id, modeTag },
  });

  const record: TutorSessionRecord = {
    id: sessionRow.id,
    title,
    topic,
    modeTag,
    status: "active",
    startedAt: sessionRow.started_at,
    endedAt: null,
    durationSeconds: null,
    referenceSummary,
    discussionSummary: "",
    liveNotesJson: sessionRow.live_notes_json,
    liveNotesText: "",
    recapMarkdown: null,
    recapGeneratedAt: null,
    recapStatus: "idle",
    createdAt: sessionRow.created_at,
    updatedAt: sessionRow.updated_at,
    uploads: insertedUploads,
    transcript: [],
  };

  return NextResponse.json({ session: record }, { status: 201 });
}
