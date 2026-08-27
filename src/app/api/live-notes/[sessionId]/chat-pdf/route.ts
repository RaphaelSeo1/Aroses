import { NextResponse } from "next/server";
import { extractChatPdfFromStorage } from "@/lib/live-notes/extract-chat-pdf";
import { createRouteHandlerSupabase } from "@/lib/supabase/route-handler-client";
import { isUuid } from "@/lib/voice-tutor/uuid";

export const runtime = "nodejs";
export const maxDuration = 60;

type Params = { params: Promise<{ sessionId: string }> };

/**
 * POST /api/live-notes/[sessionId]/chat-pdf
 * Body: { storagePath: string, fileName?: string }
 * Client already uploaded the PDF to study-pdf-ingest. Extract selectable
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

  const result = await extractChatPdfFromStorage({
    storagePath: b.storagePath.trim(),
    userId: user.id,
    fileName: typeof b.fileName === "string" ? b.fileName : undefined,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    fileName: result.fileName,
    text: result.text,
  });
}
