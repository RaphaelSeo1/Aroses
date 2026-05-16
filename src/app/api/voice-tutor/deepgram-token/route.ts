import { NextResponse } from "next/server";
import { createRouteHandlerSupabase } from "@/lib/supabase/route-handler-client";
import { canReadStudyMaterial } from "@/lib/voice-tutor/material-access";
import { getVoiceTutorGate } from "@/lib/voice-tutor/policy";
import { isUuid } from "@/lib/voice-tutor/uuid";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  const deepgramKey = normalizeDeepgramKey(process.env.DEEPGRAM_API_KEY);
  if (!deepgramKey) {
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

  const ttlSeconds = 120;
  const res = await fetch("https://api.deepgram.com/v1/auth/grant", {
    method: "POST",
    headers: {
      Authorization: `Token ${deepgramKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ttl_seconds: ttlSeconds }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("Deepgram token grant failed", res.status, text.slice(0, 400));
    let detail = "Deepgram rejected the live transcription token request.";
    try {
      const parsed = JSON.parse(text) as {
        err_msg?: unknown;
        message?: unknown;
        error?: unknown;
      };
      const raw =
        typeof parsed.err_msg === "string"
          ? parsed.err_msg
          : typeof parsed.message === "string"
            ? parsed.message
            : typeof parsed.error === "string"
              ? parsed.error
              : "";
      if (raw) detail = `Deepgram rejected the token request: ${raw}`;
    } catch {
      if (text.trim()) {
        detail = `Deepgram rejected the token request (${res.status}).`;
      }
    }
    return NextResponse.json(
      { error: detail },
      { status: 502 }
    );
  }

  const data = (await res.json()) as {
    access_token?: unknown;
    expires_in?: unknown;
  };
  if (typeof data.access_token !== "string") {
    return NextResponse.json(
      { error: "Deepgram did not return a token." },
      { status: 502 }
    );
  }

  return NextResponse.json({
    accessToken: data.access_token,
    expiresIn:
      typeof data.expires_in === "number" ? data.expires_in : ttlSeconds,
  });
}

function normalizeDeepgramKey(raw: string | undefined): string {
  let key = raw?.trim() ?? "";
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1).trim();
  }
  return key.replace(/^(token|bearer)\s+/i, "").trim();
}
