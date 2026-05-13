import { NextResponse } from "next/server";
import { createRouteHandlerSupabase } from "@/lib/supabase/route-handler-client";
import { synthesizeElevenLabs } from "@/lib/voice-tutor/elevenlabs-tts";
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
  };

  if (typeof b.text !== "string" || !b.text.trim()) {
    return NextResponse.json({ error: "text required" }, { status: 400 });
  }
  const text = b.text.trim();
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

  const modelId =
    process.env.ELEVENLABS_MODEL_ID?.trim() || "eleven_multilingual_v2";

  try {
    const buf = await synthesizeElevenLabs({
      apiKey: elevenKey,
      voiceId: resolvedVoiceId,
      text,
      modelId,
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
