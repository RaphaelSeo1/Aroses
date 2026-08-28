import { NextResponse } from "next/server";
import { createRouteHandlerSupabase } from "@/lib/supabase/route-handler-client";
import {
  DEFAULT_ELEVENLABS_MODEL_ID,
  streamElevenLabsTts,
  synthesizeElevenLabs,
} from "@/lib/voice-tutor/elevenlabs-tts";
import { authorizeVoiceTutorTarget } from "@/lib/voice-tutor/authorize-voice-target";
import { resolveTtsVoiceId } from "@/lib/voice-tutor/resolve-tts-voice";
import {
  checkVoiceAllowance,
  estimateTtsSeconds,
  recordVoiceSeconds,
} from "@/lib/billing/voice-usage";
import { voiceCapBody } from "@/lib/voice-tutor/voice-cap";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_TEXT = 6000;

export async function POST(request: Request) {
  let elevenKey: string;
  try {
    elevenKey = requireEnv("ELEVENLABS_API_KEY");
  } catch {
    return NextResponse.json(
      { error: "Voice playback is not configured (missing ELEVENLABS_API_KEY)." },
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const b = body as {
    text?: unknown;
    materialId?: unknown;
    sessionId?: unknown;
    courseId?: unknown;
    stream?: unknown;
    previousText?: unknown;
    nextText?: unknown;
    voiceLanguage?: unknown;
  };
  const streamRequested = b.stream === true;

  if (typeof b.text !== "string" || !b.text.trim()) {
    return NextResponse.json({ error: "text required" }, { status: 400 });
  }
  const text = b.text.trim();
  const previousText =
    typeof b.previousText === "string" ? b.previousText.trim() : undefined;
  const nextText =
    typeof b.nextText === "string" ? b.nextText.trim() : undefined;
  const voiceLanguage =
    typeof b.voiceLanguage === "string" ? b.voiceLanguage : undefined;
  const smootherStreaming =
    voiceLanguage && voiceLanguage !== "auto" && voiceLanguage !== "en";
  if (text.length > MAX_TEXT) {
    return NextResponse.json({ error: "text too long" }, { status: 400 });
  }

  // Auth: study material, tutor session, or live-lecture session.
  const target = await authorizeVoiceTutorTarget(supabase, user.id, {
    sessionId: b.sessionId,
    materialId: b.materialId,
    courseId: b.courseId,
  });
  if (!target.ok) {
    return NextResponse.json({ error: target.error }, { status: target.status });
  }
  const courseId = target.courseId;

  // Voice cap (applies to every surface — mentored, tutor sessions, dock).
  // Over the monthly allowance → 402 so the client falls back to text mode.
  const allowance = await checkVoiceAllowance(user.id, { email: user.email });
  if (!allowance.allowed) {
    return NextResponse.json(voiceCapBody(), { status: 402 });
  }

  let resolvedVoiceId: string;
  try {
    resolvedVoiceId = resolveTtsVoiceId(courseId);
  } catch {
    return NextResponse.json(
      { error: "Voice playback is not configured (missing ELEVENLABS_VOICE_ID)." },
      { status: 503 }
    );
  }

  // Default to Flash for conversational latency. Override with
  // `ELEVENLABS_MODEL_ID=eleven_multilingual_v2` if you prefer the older
  // consistency-first model on dense academic passages.
  const modelId =
    process.env.ELEVENLABS_MODEL_ID?.trim() || DEFAULT_ELEVENLABS_MODEL_ID;

  try {
    if (streamRequested) {
      const upstream = await streamElevenLabsTts({
        apiKey: elevenKey,
        voiceId: resolvedVoiceId,
        text,
        modelId,
        ...(smootherStreaming ? { optimizeStreamingLatency: 1 } : {}),
        previousText,
        nextText,
      });
      if (!upstream.ok || !upstream.body) {
        const t = await upstream.text();
        console.error("ElevenLabs stream error", upstream.status, t.slice(0, 400));
        return NextResponse.json(
          { error: "Speech synthesis failed. Try again." },
          { status: 502 }
        );
      }
      // Meter spoken seconds by counting MP3 bytes as they stream through, then
      // record once the stream finishes. Metering never blocks playback.
      const userId = user.id;
      let bytes = 0;
      const meter = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          bytes += chunk.byteLength;
          controller.enqueue(chunk);
        },
        async flush() {
          await recordVoiceSeconds(userId, estimateTtsSeconds(bytes));
        },
      });
      return new Response(upstream.body.pipeThrough(meter), {
        status: 200,
        headers: {
          "Content-Type": "audio/mpeg",
          "Cache-Control": "no-store, no-transform",
          "X-Accel-Buffering": "no",
        },
      });
    }

    const buf = await synthesizeElevenLabs({
      apiKey: elevenKey,
      voiceId: resolvedVoiceId,
      text,
      modelId,
      previousText,
      nextText,
    });
    await recordVoiceSeconds(user.id, estimateTtsSeconds(buf.byteLength));
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: "Speech synthesis failed. Try again." },
      { status: 502 }
    );
  }
}

function requireEnv(name: "ELEVENLABS_API_KEY"): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`missing ${name}`);
  return v;
}
