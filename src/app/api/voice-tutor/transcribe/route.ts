import { NextResponse } from "next/server";
import { createRouteHandlerSupabase } from "@/lib/supabase/route-handler-client";
import { transcribeWithWhisper } from "@/lib/voice-tutor/transcribe-openai";
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
  const languageRaw = formData.get("language");
  const file = formData.get("file");
  const language =
    typeof languageRaw === "string" && WHISPER_LANGUAGE_CODES.has(languageRaw)
      ? languageRaw
      : undefined;

  if (typeof materialIdRaw !== "string" || !isUuid(materialIdRaw)) {
    return NextResponse.json({ error: "Invalid materialId" }, { status: 400 });
  }

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing audio file" }, { status: 400 });
  }

  if (file.size === 0) {
    return NextResponse.json({ error: "Empty recording" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Recording too large" }, { status: 413 });
  }

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
    console.error(e);
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
