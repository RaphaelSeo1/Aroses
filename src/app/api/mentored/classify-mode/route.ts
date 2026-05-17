import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { stripJsonFence } from "@/lib/ai/course-payload";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/mentored/classify-mode
 *   Body: { utterance: string }
 *   Returns: { mode: "mentored" | "free" | "unclear", confidence: number }
 *
 * Used by the immersive mode picker after the student speaks their choice.
 * A naive keyword regex was the v1; this endpoint lets the AI handle softer
 * phrasings like "yeah just let me skim it" → free, "walk me through it" →
 * mentored, "I'm not sure" → unclear (so the picker re-prompts).
 *
 * Uses Haiku (fast model) — this is a single-classification call and we
 * don't need Sonnet quality. Authenticated to prevent abuse.
 */

const FAST_MODEL = "claude-haiku-4-5";

export async function POST(request: Request) {
  // Auth: simple gate — must be signed in. We don't need a materialId here
  // since this is a pure classifier with no per-course state.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let body: { utterance?: unknown };
  try {
    body = (await request.json()) as { utterance?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const utterance =
    typeof body.utterance === "string" ? body.utterance.trim().slice(0, 600) : "";
  if (utterance.length < 1) {
    return NextResponse.json(
      { mode: "unclear", confidence: 0 },
      { status: 200 }
    );
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Fall back to keyword classifier so the picker still works in
    // environments without an Anthropic key (local dev w/o secrets).
    return NextResponse.json(keywordClassify(utterance));
  }

  try {
    const anthropic = new Anthropic({ apiKey, timeout: 12_000, maxRetries: 0 });
    const msg = await anthropic.messages.create({
      model: FAST_MODEL,
      max_tokens: 80,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: `A student was asked: "Would you like Mentored Learning, where the AI tutor guides you through the material together, or Free Exploration, where you read and explore on your own?"

The student just said: """
${utterance}
"""

Classify their preference. Output STRICT JSON only (no markdown):
{
  "mode": "mentored" | "free" | "unclear",
  "confidence": 0.0..1.0
}

Rules:
- "mentored" if they sound like they want guided help, tutoring, walk-through, teaching, mentoring, working together, structure.
- "free" if they sound like they want to read alone, explore on their own, browse, skim, self-pace, look around themselves.
- "unclear" if the answer is off-topic, ambiguous, or asks a question back instead of choosing.
- confidence reflects how certain you are — use < 0.5 when you're guessing.`,
        },
      ],
    });

    const block = msg.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") {
      return NextResponse.json(keywordClassify(utterance));
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(stripJsonFence(block.text));
    } catch {
      return NextResponse.json(keywordClassify(utterance));
    }
    const raw = parsed as { mode?: unknown; confidence?: unknown };
    const mode =
      raw.mode === "mentored" || raw.mode === "free" || raw.mode === "unclear"
        ? raw.mode
        : "unclear";
    const confidence =
      typeof raw.confidence === "number" &&
      Number.isFinite(raw.confidence) &&
      raw.confidence >= 0 &&
      raw.confidence <= 1
        ? raw.confidence
        : mode === "unclear"
          ? 0.3
          : 0.7;
    return NextResponse.json({ mode, confidence });
  } catch (e) {
    console.error("[mentored/classify-mode]", e);
    return NextResponse.json(keywordClassify(utterance));
  }
}

/**
 * Fallback classifier that doesn't require an LLM. Used when the API key is
 * missing (local dev) or Anthropic fails. Same heuristic as the picker's
 * original inline implementation.
 */
function keywordClassify(text: string): {
  mode: "mentored" | "free" | "unclear";
  confidence: number;
} {
  const lower = text.toLowerCase();
  if (
    /\b(free|explore|exploration|on my own|by myself|read|alone|self|skim|browse)\b/.test(
      lower
    )
  ) {
    return { mode: "free", confidence: 0.55 };
  }
  if (
    /\b(mentor|mentored|guide|guided|tutor|teach|walk me|together|coach|help me|show me)\b/.test(
      lower
    )
  ) {
    return { mode: "mentored", confidence: 0.55 };
  }
  return { mode: "unclear", confidence: 0.2 };
}
