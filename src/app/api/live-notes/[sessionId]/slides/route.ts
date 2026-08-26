import { NextResponse } from "next/server";
import { extractSlideDeckFromBuffer } from "@/lib/live-notes/extract-slide-deck";
import {
  isSlideDeckSchemaError,
  MAX_DECK_PAGES,
} from "@/lib/live-notes/slide-pages";
import { detectIngestFormat, MAX_INGEST_DOCUMENT_BYTES } from "@/lib/study-ingest/formats";
import { isValidIngestStoragePath } from "@/lib/study-ingest/path";
import { STUDY_PDF_INGEST_BUCKET } from "@/lib/study-pdf-ingest";
import { createAdminClient } from "@/lib/supabase/admin";
import { createRouteHandlerSupabase } from "@/lib/supabase/route-handler-client";
import { isUuid } from "@/lib/voice-tutor/uuid";

export const runtime = "nodejs";
export const maxDuration = 60;

type Params = { params: Promise<{ sessionId: string }> };

/**
 * POST /api/live-notes/[sessionId]/slides
 *   Body: { storagePath: string, fileName?: string }
 *   Client already uploaded the file to study-pdf-ingest. Extract per-page
 *   text and replace any previous deck on this session.
 *
 * DELETE /api/live-notes/[sessionId]/slides
 *   Detach the deck (pages + session columns). Storage object is best-effort
 *   removed.
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

  const { data: session, error: sessLoadErr } = await supabase
    .from("live_lecture_sessions")
    .select("id, user_id, status, slides_storage_path")
    .eq("id", sessionId)
    .maybeSingle();
  if (sessLoadErr && isSlideDeckSchemaError(sessLoadErr.message)) {
    return NextResponse.json(
      {
        error:
          "Slide upload needs a database update. Apply migration 102_live_lecture_slide_pages.sql in Supabase, then try again.",
      },
      { status: 503 }
    );
  }
  if (!session || session.user_id !== user.id) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (session.status === "failed") {
    return NextResponse.json(
      { error: "This session has ended." },
      { status: 409 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const b = body as { storagePath?: unknown; fileName?: unknown };
  if (typeof b.storagePath !== "string" || !b.storagePath.trim()) {
    return NextResponse.json({ error: "storagePath required" }, { status: 400 });
  }
  const storagePath = b.storagePath.trim();
  if (!isValidIngestStoragePath(storagePath, user.id)) {
    return NextResponse.json({ error: "Invalid storage path" }, { status: 400 });
  }
  const fileName =
    typeof b.fileName === "string" && b.fileName.trim()
      ? b.fileName.trim().slice(0, 200)
      : storagePath.split("/").pop() || "slides.pdf";
  const kind = detectIngestFormat(fileName);
  if (kind !== "pdf" && kind !== "slides") {
    return NextResponse.json(
      { error: "Upload a PDF or PowerPoint (.pptx) of the lecture slides." },
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

  const { data: blob, error: dlErr } = await admin.storage
    .from(STUDY_PDF_INGEST_BUCKET)
    .download(storagePath);
  if (dlErr || !blob) {
    return NextResponse.json(
      { error: "Could not read the uploaded file. Try uploading again." },
      { status: 400 }
    );
  }
  const buffer = Buffer.from(await blob.arrayBuffer());
  if (buffer.length > MAX_INGEST_DOCUMENT_BYTES) {
    await admin.storage.from(STUDY_PDF_INGEST_BUCKET).remove([storagePath]).catch(() => {});
    const maxMb = Math.round(MAX_INGEST_DOCUMENT_BYTES / (1024 * 1024));
    return NextResponse.json(
      { error: `That file is too large. Maximum is ${maxMb}MB.` },
      { status: 400 }
    );
  }

  let pages;
  try {
    pages = await extractSlideDeckFromBuffer({ buffer, fileName });
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof Error && e.message
            ? e.message
            : "Could not read slides from that file.",
      },
      { status: 400 }
    );
  }
  if (pages.length === 0) {
    return NextResponse.json(
      {
        error:
          "No readable text on those slides. Export as PDF with selectable text, or use a .pptx (not a scan).",
      },
      { status: 400 }
    );
  }

  const previousPath =
    typeof session.slides_storage_path === "string"
      ? session.slides_storage_path
      : null;

  const { error: delErr } = await supabase
    .from("live_lecture_slide_pages")
    .delete()
    .eq("session_id", sessionId);
  if (delErr && isSlideDeckSchemaError(delErr.message)) {
    return NextResponse.json(
      {
        error:
          "Slide upload needs a database update. Apply migration 102_live_lecture_slide_pages.sql in Supabase, then try again.",
      },
      { status: 503 }
    );
  }
  if (delErr) {
    console.error("[live-notes/slides] delete pages", delErr);
    return NextResponse.json(
      { error: "Could not replace the previous slides." },
      { status: 500 }
    );
  }

  const rows = pages.slice(0, MAX_DECK_PAGES).map((p) => ({
    session_id: sessionId,
    page_num: p.pageNum,
    title: p.title,
    extracted_text: p.extractedText,
  }));
  const { error: insErr } = await supabase
    .from("live_lecture_slide_pages")
    .insert(rows);
  if (insErr) {
    console.error("[live-notes/slides] insert pages", insErr);
    if (isSlideDeckSchemaError(insErr.message)) {
      return NextResponse.json(
        {
          error:
            "Slide upload needs a database update. Apply migration 102_live_lecture_slide_pages.sql in Supabase, then try again.",
        },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { error: "Could not save the extracted slides." },
      { status: 500 }
    );
  }

  const { error: sessErr } = await supabase
    .from("live_lecture_sessions")
    .update({
      slides_storage_path: storagePath,
      slides_file_name: fileName,
      slides_page_count: rows.length,
      slides_seeded_through_page: 0,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId)
    .eq("user_id", user.id);
  if (sessErr) {
    console.error("[live-notes/slides] session meta", sessErr);
    if (isSlideDeckSchemaError(sessErr.message)) {
      return NextResponse.json(
        {
          error:
            "Slide notes need a database update. Apply migrations 102 and 103 in Supabase, then try again.",
        },
        { status: 503 }
      );
    }
  }

  if (previousPath && previousPath !== storagePath) {
    await admin.storage
      .from(STUDY_PDF_INGEST_BUCKET)
      .remove([previousPath])
      .catch(() => {});
  }

  return NextResponse.json({
    ok: true,
    fileName,
    pageCount: rows.length,
  });
}

export async function DELETE(_request: Request, ctx: Params) {
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
    .select("id, user_id, slides_storage_path")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session || session.user_id !== user.id) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  await supabase
    .from("live_lecture_slide_pages")
    .delete()
    .eq("session_id", sessionId);

  await supabase
    .from("live_lecture_sessions")
    .update({
      slides_storage_path: null,
      slides_file_name: null,
      slides_page_count: 0,
      slides_seeded_through_page: 0,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId)
    .eq("user_id", user.id);

  const previousPath =
    typeof session.slides_storage_path === "string"
      ? session.slides_storage_path
      : null;
  if (previousPath) {
    const admin = createAdminClient();
    if (admin) {
      await admin.storage
        .from(STUDY_PDF_INGEST_BUCKET)
        .remove([previousPath])
        .catch(() => {});
    }
  }

  return NextResponse.json({ ok: true, fileName: null, pageCount: 0 });
}
