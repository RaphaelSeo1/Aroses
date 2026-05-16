import { NextResponse } from "next/server";
import { createRouteHandlerSupabase } from "@/lib/supabase/route-handler-client";
import {
  DEFAULT_ELEVENLABS_MODEL_ID,
  streamElevenLabsTts,
  synthesizeElevenLabs,
} from "@/lib/voice-tutor/elevenlabs-tts";
import { canReadStudyMaterial } from "@/lib/voice-tutor/material-access";
import { getVoiceTutorGate } from "@/lib/voice-tutor/policy";
import { resolveTtsVoiceId } from "@/lib/voice-tutor/resolve-tts-voice";
import { isUuid } from "@/lib/voice-tutor/uuid";

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

  if (typeof b.materialId !== "string" || !isUuid(b.materialId)) {
    return NextResponse.json({ error: "Invalid materialId" }, { status: 400 });
  }

  const courseId =
    typeof b.courseId === "string" && isUuid(b.courseId) ? b.courseId : undefined;

  const readable = await canReadStudyMaterial(supabase, b.materialId);
  if (!readable) {
    return NextResponse.json({ error: "Material not found" }, { status: 404 });
  }

  const gate = await getVoiceTutorGate({
    userId: user.id,
    materialId: b.materialId,
    courseId,
  });
  if (!gate.allowed) {
    return NextResponse.json({ error: gate.reason }, { status: 403 });
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
      if (!upstream.ok) {
        const t = await upstream.text();
        console.error("ElevenLabs stream error", upstream.status, t.slice(0, 400));
        return NextResponse.json(
          { error: "Speech synthesis failed. Try again." },
          { status: 502 }
        );
      }
      return new Response(upstream.body, {
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
