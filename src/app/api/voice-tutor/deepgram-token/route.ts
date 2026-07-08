import { NextResponse } from "next/server";
import { mintDeepgramToken, normalizeDeepgramKey } from "@/lib/deepgram";
import { createRouteHandlerSupabase } from "@/lib/supabase/route-handler-client";
import { canReadStudyMaterial } from "@/lib/voice-tutor/material-access";
import { getVoiceTutorGate } from "@/lib/voice-tutor/policy";
import { isUuid } from "@/lib/voice-tutor/uuid";
import { checkVoiceAllowance } from "@/lib/billing/voice-usage";
import { voiceCapBody } from "@/lib/voice-tutor/voice-cap";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const b = body as { materialId?: unknown; courseId?: unknown };
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

  // Live (Deepgram) STT bypasses /transcribe, so enforce the voice cap here too.
  const allowance = await checkVoiceAllowance(user.id, { email: user.email });
  if (!allowance.allowed) {
    return NextResponse.json(voiceCapBody(), { status: 402 });
  }

  const token = await mintDeepgramToken();
  if (!token.ok) {
    return NextResponse.json({ error: token.error }, { status: token.status });
  }

  return NextResponse.json({
    accessToken: token.accessToken,
    expiresIn: token.expiresIn,
  });
}
