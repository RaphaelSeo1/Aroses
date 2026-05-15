import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Turn the learner's free-form study goal into a structured draft the user
 * can review and confirm before we create the course. Returns:
 *
 *   - title    : a short, punchy course title (2–4 words, no fluff)
 *   - bullets  : 3–5 concrete focus points pulled from the user's input
 *   - summary  : a single first-person one-liner (≤ 18 words)
 *
 * The client typewriter-animates each piece to feel like the AI is composing
 * the plan live; this endpoint itself is a fast non-streaming Haiku call so
 * the whole confirm dialog appears in ~1–2 seconds.
 */
export const runtime = "nodejs";

const MODEL = "claude-haiku-4-5";
const MAX_INPUT_CHARS = 2_000;
const MAX_OUTPUT_TOKENS = 400;

function stripCodeFences(s: string): string {
  let t = s.trim();
  t = t.replace(/^```[a-zA-Z]*\s*\n?/, "");
  t = t.replace(/\n?```\s*$/, "");
  return t.trim();
}

type Draft = { title: string; bullets: string[]; summary: string };

function parseDraft(rawText: string): Draft | null {
  if (!rawText) return null;

  const candidates = [rawText, stripCodeFences(rawText)];
  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c) as {
        title?: unknown;
        bullets?: unknown;
        summary?: unknown;
      };
      const title =
        typeof parsed.title === "string" ? parsed.title.trim() : "";
      const summary =
        typeof parsed.summary === "string" ? parsed.summary.trim() : "";
      const bullets = Array.isArray(parsed.bullets)
        ? parsed.bullets
            .filter((b): b is string => typeof b === "string")
            .map((b) => b.trim())
            .filter(Boolean)
            .slice(0, 5)
        : [];
      if (title && summary && bullets.length > 0) {
        return { title, bullets, summary };
      }
    } catch {
      /* try next candidate */
    }
  }
  return null;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const raw =
    typeof (body as { study_context?: unknown })?.study_context === "string"
      ? (body as { study_context: string }).study_context.trim()
      : "";

  if (raw.length < 4) {
    return NextResponse.json(
      { error: "Tell us a bit more about your goal first." },
      { status: 400 }
    );
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("[draft-summary] Missing ANTHROPIC_API_KEY");
    return NextResponse.json(
      { error: "Server is not configured for AI requests." },
      { status: 500 }
    );
  }

  const anthropic = new Anthropic({ apiKey });

  const system = `You help a learner confirm what they want to study before we build their course.

Take their free-form input and return THREE things:

1. **title**: a short, concrete course title — **2 to 4 words**, no generic openers like "Master" or "Explore" or "Introduction to". Use the actual subject (e.g. "Ionic Bonds Deep Dive", "MCAT Renal Physiology", "Linear Algebra Refresher").
2. **bullets**: 3 to 5 short bullet points (each ≤ 8 words) listing the *specific* topics, skills, or constraints they mentioned. Capture every concrete thing they asked for. No filler.
3. **summary**: one first-person sentence, ≤ 18 words, fixing any typos. Starts with "I want to…" or "I'm focusing on…".

OUTPUT FORMAT (strict):
- Reply with a SINGLE JSON object and nothing else.
- Do NOT wrap in markdown fences. Start with { and end with }.
- Shape: {"title": "...", "bullets": ["...", "...", "..."], "summary": "..."}
- No commentary, no explanation, no preface — only the JSON.`;

  const userPrompt = `Learner's input:\n"""${raw.slice(0, MAX_INPUT_CHARS)}"""`;

  try {
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      system,
      messages: [{ role: "user", content: userPrompt }],
    });

    const rawText = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    const draft = parseDraft(rawText);

    if (!draft) {
      console.warn("[draft-summary] unparsable draft", { rawText });
      return NextResponse.json(
        { error: "Couldn't draft a plan — please rephrase and try again." },
        { status: 502 }
      );
    }

    return NextResponse.json(draft);
  } catch (err) {
    console.error("[draft-summary]", err);
    return NextResponse.json(
      { error: "Couldn't reach the AI service. Try again in a moment." },
      { status: 502 }
    );
  }
}
