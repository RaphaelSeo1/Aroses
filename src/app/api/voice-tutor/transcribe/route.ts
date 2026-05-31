import { NextResponse } from "next/server";
import { createRouteHandlerSupabase } from "@/lib/supabase/route-handler-client";
import {
  transcribeWithWhisper,
  WhisperError,
} from "@/lib/voice-tutor/transcribe-openai";
import { canReadStudyMaterial } from "@/lib/voice-tutor/material-access";
import { getVoiceTutorGate } from "@/lib/voice-tutor/policy";
import { isUuid } from "@/lib/voice-tutor/uuid";

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

  // Tutor Session path: validate session ownership and skip the
  // material access / voice gate (no per-material cost attribution
  // on sessions yet).
  if (typeof sessionIdRaw === "string" && isUuid(sessionIdRaw)) {
    const { data: sessionRow } = await supabase
      .from("tutor_sessions")
      .select("user_id")
      .eq("id", sessionIdRaw)
      .maybeSingle();
    if (!sessionRow || sessionRow.user_id !== user.id) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
  } else if (typeof materialIdRaw === "string" && isUuid(materialIdRaw)) {
    const readable = await canReadStudyMaterial(supabase, materialIdRaw);
    if (!readable) {
      return NextResponse.json({ error: "Material not found" }, { status: 404 });
    }
    const gate = await getVoiceTutorGate({
      userId: user.id,
      materialId: materialIdRaw,
    });
    if (!gate.allowed) {
      return NextResponse.json({ error: gate.reason }, { status: 403 });
    }
  } else {
    return NextResponse.json(
      { error: "Missing materialId or sessionId" },
      { status: 400 }
    );
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
