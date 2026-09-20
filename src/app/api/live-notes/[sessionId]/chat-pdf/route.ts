import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { extractChatAttachmentFromStorage } from "@/lib/live-notes/extract-chat-pdf";
import { createRouteHandlerSupabase } from "@/lib/supabase/route-handler-client";
import { isUuid } from "@/lib/voice-tutor/uuid";

export const runtime = "nodejs";
export const maxDuration = 90;

type Params = { params: Promise<{ sessionId: string }> };

/**
 * POST /api/live-notes/[sessionId]/chat-pdf
 * Body: { storagePath: string, fileName?: string }
 * Client already uploaded a document/image to study-pdf-ingest. Extract
 * text for lecture chat (does not replace the lecture slide deck).
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

  const { data: session } = await supabase
    .from("live_lecture_sessions")
    .select("id, user_id, status")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session || session.user_id !== user.id) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (session.status === "failed") {
    return NextResponse.json({ error: "This session has ended." }, { status: 409 });
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

  const result = await extractChatAttachmentFromStorage({
    storagePath: b.storagePath.trim(),
    userId: user.id,
    fileName: typeof b.fileName === "string" ? b.fileName : undefined,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  if (result.sourceTruncated) {
    return NextResponse.json(
      {
        error:
          "This file has too much extracted text for a lossless note rebuild. Split it into smaller files and attach them separately.",
      },
      { status: 400 }
    );
  }

  // Keep the extracted source with the session. Reconciliation may happen
  // after more audio or another deck arrives, so browser sessionStorage is
  // not a durable source of truth. Older databases continue without this.
  const sourceHash = createHash("sha256")
    .update(`${result.fileName}\0${result.sourceText}`)
    .digest("hex");
  try {
    const { error } = await supabase.from("live_lecture_note_sources").upsert(
      {
        session_id: sessionId,
        user_id: user.id,
        source_kind: result.kind,
        name: result.fileName,
        source_hash: sourceHash,
        extracted_text: result.sourceText,
      },
      { onConflict: "session_id,source_hash", ignoreDuplicates: true }
    );
    if (error && /schema cache|does not exist/i.test(error.message)) {
      return NextResponse.json(
        {
          error:
            "File-backed notes need database migration 111 before attachments can be used safely.",
        },
        { status: 503 }
      );
    }
    if (error) {
      console.error("[live-notes/chat-pdf] persist source", error);
      return NextResponse.json(
        { error: "Could not save this file as a durable note source." },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("[live-notes/chat-pdf] persist source", error);
    return NextResponse.json(
      { error: "Could not save this file as a durable note source." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    fileName: result.fileName,
    text: result.text,
  });
}
