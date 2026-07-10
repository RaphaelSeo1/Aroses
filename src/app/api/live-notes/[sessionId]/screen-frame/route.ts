import { NextResponse } from "next/server";
import { extractScreenContent } from "@/lib/ai/live-screen-vision";
import { report } from "@/lib/report-error";
import { createRouteHandlerSupabase } from "@/lib/supabase/route-handler-client";
import { isUuid } from "@/lib/voice-tutor/uuid";

export const runtime = "nodejs";
export const maxDuration = 60;

type Params = { params: Promise<{ sessionId: string }> };

/** Hard per-session cap on screen-vision Haiku calls. */
const MAX_SCREEN_VISION_CALLS = 80;
const MAX_JPEG_BYTES = 450_000;

/**
 * POST /api/live-notes/[sessionId]/screen-frame
 *
 * Body (JSON): { jpegBase64: string, atMs?: number, mediaType?: string }
 * Returns: { seq, title, flatText, tableMarkdown, isArosesUi, capped? }
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const b = body as {
    jpegBase64?: unknown;
    atMs?: unknown;
    mediaType?: unknown;
  };
  if (typeof b.jpegBase64 !== "string" || b.jpegBase64.length < 100) {
    return NextResponse.json({ error: "jpegBase64 required" }, { status: 400 });
  }
  // Rough byte estimate from base64 length
  const approxBytes = Math.floor((b.jpegBase64.length * 3) / 4);
  if (approxBytes > MAX_JPEG_BYTES) {
    return NextResponse.json({ error: "Frame too large" }, { status: 413 });
  }

  const atMs =
    typeof b.atMs === "number" && Number.isFinite(b.atMs) && b.atMs >= 0
      ? Math.round(b.atMs)
      : 0;
  const mediaType =
    b.mediaType === "image/png" || b.mediaType === "image/webp"
      ? b.mediaType
      : "image/jpeg";

  const { data: session } = await supabase
    .from("live_lecture_sessions")
    .select("id, status, screen_vision_calls")
    .eq("id", sessionId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!session) {
    // Retry without the new column if migration 084 isn't applied yet.
    const { data: legacy } = await supabase
      .from("live_lecture_sessions")
      .select("id, status")
      .eq("id", sessionId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!legacy) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    return NextResponse.json(
      {
        error:
          "Screen reading needs a database update. Apply migration 084_live_lecture_screen_content.sql, then try again.",
      },
      { status: 503 }
    );
  }
  if (session.status === "completed" || session.status === "failed") {
    return NextResponse.json({ error: "This session has ended." }, { status: 409 });
  }

  const calls =
    typeof session.screen_vision_calls === "number"
      ? session.screen_vision_calls
      : 0;
  if (calls >= MAX_SCREEN_VISION_CALLS) {
    return NextResponse.json({ capped: true, calls });
  }

  const extract = await extractScreenContent({
    jpegBase64: b.jpegBase64,
    mediaType,
    userId: user.id,
  });
  if (!extract) {
    void report("live-notes.screen_vision_failed", new Error("extract null"), {
      userId: user.id,
      detail: { sessionId },
    });
    return NextResponse.json(
      { error: "Could not read the screen frame." },
      { status: 502 }
    );
  }

  const nextCalls = calls + 1;
  await supabase
    .from("live_lecture_sessions")
    .update({
      screen_vision_calls: nextCalls,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId)
    .eq("user_id", user.id);

  // Next seq = max existing + 1
  const { data: lastRow } = await supabase
    .from("live_lecture_screen_content")
    .select("seq")
    .eq("session_id", sessionId)
    .order("seq", { ascending: false })
    .limit(1)
    .maybeSingle();
  const seq =
    typeof lastRow?.seq === "number" && Number.isFinite(lastRow.seq)
      ? lastRow.seq + 1
      : 1;

  if (extract.flatText.trim() || extract.isArosesUi) {
    const { error: insertErr } = await supabase
      .from("live_lecture_screen_content")
      .upsert(
        {
          session_id: sessionId,
          seq,
          at_ms: atMs,
          title: extract.title,
          extracted_text: extract.flatText || extract.bodyText || "",
          table_markdown: extract.tableText,
        },
        { onConflict: "session_id,seq", ignoreDuplicates: true }
      );
    if (insertErr) {
      console.error("[live-notes/screen-frame] insert", sessionId, insertErr);
    }
  }

  return NextResponse.json({
    seq,
    title: extract.title,
    flatText: extract.flatText,
    tableMarkdown: extract.tableText,
    isArosesUi: extract.isArosesUi,
    calls: nextCalls,
    capped: nextCalls >= MAX_SCREEN_VISION_CALLS,
  });
}
