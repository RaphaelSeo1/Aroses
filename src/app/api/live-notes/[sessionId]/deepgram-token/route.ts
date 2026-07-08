import { NextResponse } from "next/server";
import { checkVoiceAllowance } from "@/lib/billing/voice-usage";
import { mintDeepgramToken, normalizeDeepgramKey } from "@/lib/deepgram";
import { report } from "@/lib/report-error";
import { createRouteHandlerSupabase } from "@/lib/supabase/route-handler-client";
import { voiceCapBody } from "@/lib/voice-tutor/voice-cap";
import { isUuid } from "@/lib/voice-tutor/uuid";

export const runtime = "nodejs";
export const maxDuration = 30;

type Params = { params: Promise<{ sessionId: string }> };

/**
 * POST /api/live-notes/[sessionId]/deepgram-token
 *
 * Mints a short-lived Deepgram access token for the live lecture capture
 * WebSocket. Same voice-cap gating as the voice-tutor flavor; scoped to an
 * active (recording/paused) session the caller owns. Called on every
 * (re)connect — the token TTL only matters at connect time.
 */
export async function POST(_request: Request, ctx: Params) {
  const { sessionId } = await ctx.params;
  if (!isUuid(sessionId)) {
    return NextResponse.json({ error: "Invalid session id" }, { status: 400 });
  }

  if (!normalizeDeepgramKey(process.env.DEEPGRAM_API_KEY)) {
    return NextResponse.json(
      { error: "Live transcription is not configured (missing DEEPGRAM_API_KEY)." },
      { status: 503 }
    );
  }

  const supabase = await createRouteHandlerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // RLS restricts the row to its owner; a miss is 404 either way.
  const { data: session } = await supabase
    .from("live_lecture_sessions")
    .select("id, status")
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

  const allowance = await checkVoiceAllowance(user.id, { email: user.email });
  if (!allowance.allowed) {
    return NextResponse.json(voiceCapBody(), { status: 402 });
  }

  const token = await mintDeepgramToken();
  if (!token.ok) {
    void report("live-notes.deepgram_token_failed", token.error, {
      userId: user.id,
      detail: { sessionId, status: token.status },
    });
    return NextResponse.json({ error: token.error }, { status: token.status });
  }

  return NextResponse.json({
    accessToken: token.accessToken,
    expiresIn: token.expiresIn,
  });
}
