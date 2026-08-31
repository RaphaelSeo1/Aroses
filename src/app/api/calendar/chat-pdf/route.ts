import { NextResponse } from "next/server";
import { extractChatAttachmentFromStorage } from "@/lib/live-notes/extract-chat-pdf";
import { createRouteHandlerSupabase } from "@/lib/supabase/route-handler-client";

export const runtime = "nodejs";
export const maxDuration = 90;

/**
 * POST /api/calendar/chat-pdf
 * Body: { storagePath: string, fileName?: string }
 * Client already uploaded a document/image to study-pdf-ingest. Extract
 * text so calendar chat can use it as reference (not persisted).
 */
export async function POST(request: Request) {
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

  return NextResponse.json({
    fileName: result.fileName,
    text: result.text,
  });
}
