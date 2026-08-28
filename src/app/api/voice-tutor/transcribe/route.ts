import { NextResponse } from "next/server";
import { createRouteHandlerSupabase } from "@/lib/supabase/route-handler-client";
import {
  transcribeWithWhisper,
  WhisperError,
} from "@/lib/voice-tutor/transcribe-openai";
import { authorizeVoiceTutorTarget } from "@/lib/voice-tutor/authorize-voice-target";
import { checkVoiceAllowance } from "@/lib/billing/voice-usage";
import { voiceCapBody } from "@/lib/voice-tutor/voice-cap";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_BYTES = 4 * 1024 * 1024;
const WHISPER_LANGUAGE_CODES = new Set(["en", "es", "fr", "ko", "ja", "zh"]);

export async function POST(request: Request) {
  let openaiKey: string;
  try {
    openaiKey = requireEnv("OPENAI_API_KEY");
  } catch {
    return NextResponse.json(
      { error: "Voice transcription is not configured (missing OPENAI_API_KEY)." },
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

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data" }, { status: 400 });
  }

  const materialIdRaw = formData.get("materialId");
  const sessionIdRaw = formData.get("sessionId");
  const languageRaw = formData.get("language");
  const file = formData.get("file");
  const language =
    typeof languageRaw === "string" && WHISPER_LANGUAGE_CODES.has(languageRaw)
      ? languageRaw
      : undefined;

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing audio file" }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "Empty recording" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Recording too large" }, { status: 413 });
  }

  const target = await authorizeVoiceTutorTarget(supabase, user.id, {
    sessionId: sessionIdRaw,
    materialId: materialIdRaw,
  });
  if (!target.ok) {
    return NextResponse.json({ error: target.error }, { status: target.status });
  }

  // When the user is out of voice time, stop the mic too (not just playback) so
  // the experience consistently falls back to text. 402 → client switches mode.
  const allowance = await checkVoiceAllowance(user.id, { email: user.email });
  if (!allowance.allowed) {
    return NextResponse.json(voiceCapBody(), { status: 402 });
  }

  try {
    const audio = new Blob([await file.arrayBuffer()], {
      type: file.type || "application/octet-stream",
    });
    const text = await transcribeWithWhisper({
      audio,
      apiKey: openaiKey,
      language,
    });
    return NextResponse.json({ text });
  } catch (e) {
    console.error("[voice-tutor/transcribe]", e);

    if (e instanceof WhisperError) {
      // Map the upstream OpenAI status to an actionable message + status so
      // failures aren't all an opaque 502. The provider reason is appended in
      // dev only (it never contains secrets, but keep prod messaging clean).
      const reason =
        process.env.NODE_ENV !== "production" && e.provider
          ? ` (${e.provider})`
          : "";
      if (e.status === 401 || e.status === 403) {
        return NextResponse.json(
          {
            error: `Voice transcription is misconfigured — OpenAI rejected the request (check OPENAI_API_KEY / billing).${reason}`,
          },
          { status: 502 }
        );
      }
      if (e.status === 429) {
        return NextResponse.json(
          {
            error: `Voice transcription is rate-limited or out of OpenAI quota. Try again shortly.${reason}`,
          },
          { status: 429 }
        );
      }
      if (e.status === 400) {
        return NextResponse.json(
          {
            error: `That recording couldn't be transcribed (unsupported or empty audio). Try again.${reason}`,
          },
          { status: 400 }
        );
      }
    }

    return NextResponse.json(
      { error: "Transcription failed. Try again." },
      { status: 502 }
    );
  }
}

function requireEnv(name: "OPENAI_API_KEY"): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`missing ${name}`);
  return v;
}
