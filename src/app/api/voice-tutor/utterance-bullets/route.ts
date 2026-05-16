import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { createRouteHandlerSupabase } from "@/lib/supabase/route-handler-client";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "claude-haiku-4-5";

export async function POST(request: Request) {
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

  const text =
    typeof (body as { text?: unknown }).text === "string"
      ? (body as { text: string }).text.trim()
      : "";
  if (!text || text.length > 8000) {
    return NextResponse.json({ error: "text required" }, { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Summaries are not configured." },
      { status: 503 }
    );
  }

  const anthropic = new Anthropic({ apiKey });

  try {
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 220,
      temperature: 0.2,
      system: `You turn a student's spoken question into 2–5 very short bullet labels (max ~8 words each) that capture what they asked — not an answer. Output ONLY valid JSON: {"bullets":["..."]}. No markdown.`,
      messages: [
        {
          role: "user",
          content: text,
        },
      ],
    });
    const block = msg.content.find((c) => c.type === "text");
    const raw =
      block && block.type === "text" ? block.text.trim() : '{"bullets":[]}';
    const parsed = JSON.parse(raw) as { bullets?: unknown };
    const bullets = Array.isArray(parsed.bullets)
      ? parsed.bullets
          .filter((x): x is string => typeof x === "string")
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 6)
      : [];
    return NextResponse.json({ bullets });
  } catch (e) {
    console.error("utterance-bullets", e);
    return NextResponse.json(
      { error: "Could not summarize utterance." },
      { status: 502 }
    );
  }
}
