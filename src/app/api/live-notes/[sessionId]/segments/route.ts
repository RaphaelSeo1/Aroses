import { NextResponse } from "next/server";
import { recordVoiceSeconds } from "@/lib/billing/voice-usage";
import { createRouteHandlerSupabase } from "@/lib/supabase/route-handler-client";
import { isUuid } from "@/lib/voice-tutor/uuid";

export const runtime = "nodejs";
export const maxDuration = 30;

type Params = { params: Promise<{ sessionId: string }> };

const MAX_SEGMENTS_PER_FLUSH = 50;
const MAX_SEGMENT_CHARS = 8_000;
/** ~4h of dense speech — runaway guard on total stored transcript. */
const MAX_SEGMENTS_PER_SESSION = 5_000;

/**
 * POST /api/live-notes/[sessionId]/segments
 *   Flush finalized transcript segments from the browser buffer (~every 15s).
 *   Body: { segments: [{ seq, text, atMs }], durationSeconds? }
 *   Idempotent: (session_id, seq) is unique; retried flushes no-op on
 *   conflict, so a network retry never duplicates transcript text.
 *
 * GET /api/live-notes/[sessionId]/segments
 *   Full ordered transcript for surface hydration after a reload.
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
  const b = body as { segments?: unknown; durationSeconds?: unknown };
  if (!Array.isArray(b.segments) || b.segments.length === 0) {
    return NextResponse.json({ error: "segments required" }, { status: 400 });
  }
  if (b.segments.length > MAX_SEGMENTS_PER_FLUSH) {
    return NextResponse.json({ error: "Too many segments" }, { status: 400 });
  }

  const rows: Array<{ session_id: string; seq: number; text: string; at_ms: number }> =
    [];
  for (const raw of b.segments) {
    if (!raw || typeof raw !== "object") {
      return NextResponse.json({ error: "Invalid segment" }, { status: 400 });
    }
    const s = raw as { seq?: unknown; text?: unknown; atMs?: unknown };
    if (
      typeof s.seq !== "number" ||
      !Number.isInteger(s.seq) ||
      s.seq < 0 ||
      s.seq >= MAX_SEGMENTS_PER_SESSION ||
      typeof s.text !== "string"
    ) {
      return NextResponse.json({ error: "Invalid segment" }, { status: 400 });
    }
    const text = s.text.trim().slice(0, MAX_SEGMENT_CHARS);
    if (!text) continue;
    rows.push({
      session_id: sessionId,
      seq: s.seq,
      text,
      at_ms:
        typeof s.atMs === "number" && Number.isFinite(s.atMs) && s.atMs >= 0
          ? Math.round(s.atMs)
          : 0,
    });
  }

  // Session must exist, be owned (RLS), and still be live.
  const { data: session } = await supabase
    .from("live_lecture_sessions")
    .select("id, status, metered_seconds")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (session.status === "completed" || session.status === "failed") {
    return NextResponse.json(
      { error: "This session has ended." },
      { status: 409 }
    );
  }

  if (rows.length > 0) {
    const { error } = await supabase
      .from("live_lecture_segments")
      .upsert(rows, { onConflict: "session_id,seq", ignoreDuplicates: true });
    if (error) {
      console.error("[live-notes] segment flush", sessionId, error);
      return NextResponse.json({ error: "Could not save transcript." }, { status: 500 });
    }
  }

  const sessionPatch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  const durationSeconds =
    typeof b.durationSeconds === "number" &&
    Number.isFinite(b.durationSeconds) &&
    b.durationSeconds >= 0
      ? Math.min(24 * 60 * 60, Math.round(b.durationSeconds))
      : null;
  if (durationSeconds != null) {
    sessionPatch.duration_seconds = durationSeconds;

    // Meter Deepgram minutes against the voice cap in ~1-minute deltas (only
    // TTS was metered before; live STT rode free). `metered_seconds` tracks
    // what has been recorded so retried flushes never double-bill.
    const meteredSeconds =
      typeof session.metered_seconds === "number" ? session.metered_seconds : 0;
    const delta = durationSeconds - meteredSeconds;
    if (delta >= 60) {
      await recordVoiceSeconds(user.id, delta);
      sessionPatch.metered_seconds = durationSeconds;
    }
  }
  await supabase
    .from("live_lecture_sessions")
    .update(sessionPatch)
    .eq("id", sessionId)
    .eq("user_id", user.id);

  return NextResponse.json({ ok: true, saved: rows.length });
}

export async function GET(_request: Request, ctx: Params) {
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
    .select("id")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("live_lecture_segments")
    .select("seq, text, at_ms")
    .eq("session_id", sessionId)
    .order("seq", { ascending: true })
    .limit(MAX_SEGMENTS_PER_SESSION);
  if (error) {
    console.error("[live-notes] segments GET", sessionId, error);
    return NextResponse.json({ error: "Could not load transcript." }, { status: 500 });
  }

  return NextResponse.json({
    segments: (data ?? []).map((s) => ({
      seq: s.seq,
      text: s.text,
      atMs: s.at_ms,
    })),
  });
}
