import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { TutorSessionUpload } from "@/types/tutor-session";
import {
  extractTutorSessionUpload,
  TUTOR_SESSION_MAX_FILES,
  TUTOR_SESSION_MAX_TOTAL_BYTES,
} from "@/lib/tutor-session/extract-upload";
import { detectIngestFormat } from "@/lib/study-ingest/formats";

/**
 * POST /api/tutor-session/[sessionId]/upload
 *
 * Mid-session reference upload. Identical extraction + summary
 * pipeline as /start but operates on an existing session — pushes a
 * new row to `tutor_session_uploads` and appends to the session's
 * cached `reference_summary` so the next turn's prompt includes it.
 *
 * Accepts multipart form-data:
 *   files: File | File[]  (up to 5, ≤12 MB each)
 *
 * Returns: { uploads: TutorSessionUpload[], referenceSummary }
 *
 * Client appends a synthetic "📎 Added X" system bubble + triggers
 * the next assistant turn with an opener like "[Student just
 * uploaded Y — take a look and react.]" so Rose acknowledges it.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MAX_FILES = TUTOR_SESSION_MAX_FILES;
const MAX_TOTAL_BYTES = TUTOR_SESSION_MAX_TOTAL_BYTES;

type Params = { params: Promise<{ sessionId: string }> };

export async function POST(request: Request, ctx: Params) {
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

  // Ownership check + grab the existing reference_summary so we can
  // append to it (rather than overwrite).
  const { data: sessionRow } = await supabase
    .from("tutor_sessions")
    .select("id, user_id, status, reference_summary")
    .eq("id", sessionId)
    .maybeSingle();
  if (!sessionRow || sessionRow.user_id !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (sessionRow.status !== "active") {
    return NextResponse.json(
      { error: "Session has ended" },
      { status: 409 }
    );
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

  const fileEntries = form
    .getAll("files")
    .filter((f): f is File => f instanceof File);
  if (fileEntries.length === 0) {
    return NextResponse.json({ error: "No files." }, { status: 400 });
  }
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

  const newSummaries: string[] = [];
  const insertedUploads: TutorSessionUpload[] = [];
  const failedFiles: string[] = [];

  for (const file of fileEntries) {
    const buf = Buffer.from(await file.arrayBuffer());
    const mime = file.type || "application/octet-stream";
    const formatKind = detectIngestFormat(file.name, mime);
    if (!formatKind) {
      failedFiles.push(`${file.name} (unsupported type)`);
      continue;
    }
    const fileKind: "pdf" | "image" | "text" =
      formatKind === "pdf"
        ? "pdf"
        : formatKind === "image"
          ? "image"
          : "text";

    const safeName = file.name.replace(/[^\w.\-]+/g, "_").slice(0, 120);
    const storagePath = `${user.id}/${sessionId}/${Date.now()}-${safeName}`;
    const { error: storageError } = await supabase.storage
      .from("tutor-session-uploads")
      .upload(storagePath, buf, { contentType: mime, upsert: false });
    if (storageError) {
      console.error("[tutor-session upload storage]", storageError);
      failedFiles.push(file.name);
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
      const msg = e instanceof Error ? e.message : "extract failed";
      console.error("[tutor-session upload extract]", e);
      failedFiles.push(`${file.name} (${msg})`);
      continue;
    }

    const { data: uploadRow, error: insertError } = await supabase
      .from("tutor_session_uploads")
      .insert({
        session_id: sessionId,
        user_id: user.id,
        file_name: file.name,
        file_kind: fileKind,
        mime_type: mime,
        size_bytes: file.size,
        storage_path: storagePath,
        extracted_content: extractedContent,
        summary,
      })
      .select(
        "id, file_name, file_kind, mime_type, size_bytes, summary, created_at"
      )
      .single();
    if (insertError || !uploadRow) {
      console.error("[tutor-session upload insert]", insertError);
      failedFiles.push(file.name);
      continue;
    }

    newSummaries.push(`[${uploadRow.file_name}] ${summary}`);
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

  // Append new summaries to the running reference_summary. Soft cap
  // at 8000 chars (slightly larger than start to allow growth).
  const merged = [sessionRow.reference_summary, ...newSummaries]
    .filter((s) => typeof s === "string" && s.length > 0)
    .join("\n\n")
    .slice(0, 8000);

  await supabase
    .from("tutor_sessions")
    .update({
      reference_summary: merged,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId)
    .eq("user_id", user.id);

  return NextResponse.json({
    uploads: insertedUploads,
    referenceSummary: merged,
    failed: failedFiles,
  });
}
