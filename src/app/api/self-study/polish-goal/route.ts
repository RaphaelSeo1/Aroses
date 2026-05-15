import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Rewrite the learner's free-form study goal into a tight, professional
 * one-liner that fits the workspace badge. We keep the input small and the
 * output capped so this is a cheap Haiku call — meant to feel instant when
 * the user clicks "Polish my goal" on the self-study creation form.
 */
export const runtime = "nodejs";

const MODEL = "claude-haiku-4-5";
const MAX_INPUT_CHARS = 2_000;
const MAX_OUTPUT_TOKENS = 200;

/** Strip the ` ```json ` / ` ``` ` fences Claude occasionally wraps JSON in,
 *  along with any leading/trailing whitespace. */
function stripCodeFences(s: string): string {
  let t = s.trim();
  // Opening fence: ```json , ```JSON , or just ```
  t = t.replace(/^```[a-zA-Z]*\s*\n?/, "");
  // Closing fence anywhere at the end
  t = t.replace(/\n?```\s*$/, "");
  return t.trim();
}

/** Try every reasonable way to pull the polished one-liner out of the
 *  model's response. Order: parse as JSON (with fences stripped) → look
 *  for an inline `"summary": "..."` substring → fall back to the whole
 *  text minus quotes. Returns "" if nothing usable was found. */
function extractSummary(rawText: string): string {
  if (!rawText) return "";

  const candidates = [rawText, stripCodeFences(rawText)];

  // 1. Try strict JSON parse on whichever variant works.
  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c) as { summary?: unknown };
      if (parsed && typeof parsed.summary === "string") {
        const s = parsed.summary.trim();
        if (s) return s;
      }
    } catch {
      /* keep trying */
    }
  }

  // 2. Regex out a `"summary": "..."` field embedded in prose. Handles
  //    the case where the model added a stray prefix like
  //    `Here is the summary: {"summary": "..."}`.
  const inline = rawText.match(/"summary"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (inline?.[1]) {
    const s = inline[1].replace(/\\"/g, '"').trim();
    if (s) return s;
  }

  // 3. Last resort: assume the whole thing is the summary, stripping
  //    fences + surrounding quotes.
  const bare = stripCodeFences(rawText).replace(/^"+|"+$/g, "").trim();
  return bare;
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
      ? ((body as { study_context: string }).study_context.trim())
      : "";

  if (raw.length < 4) {
    return NextResponse.json(
      { error: "Tell us a bit more about your goal first." },
      { status: 400 }
    );
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("[polish-goal] Missing ANTHROPIC_API_KEY");
    return NextResponse.json(
      { error: "Server is not configured for AI requests." },
      { status: 500 }
    );
  }

  const anthropic = new Anthropic({ apiKey });

  const system = `You rewrite a learner's free-form study request into a clean, professional one-liner that a tutor would understand at a glance.

OUTPUT FORMAT (very strict):
- Reply with a single JSON object and NOTHING else.
- Do NOT wrap the JSON in markdown fences. No \`\`\`, no \`\`\`json, no commentary.
- Start your reply with the character { and end it with the character }.
- Shape: {"summary": "..."}.

Content rules:
- The summary is ONE sentence, **under 18 words**, written in the FIRST PERSON ("I want to ..." or "I'm focusing on ...").
- Keep every concrete topic, exam, or skill the learner mentioned. Drop filler ("so I can", "really really", typos).
- Fix typos and grammar silently. Do NOT add new topics or invent context.
- Plain text only — no bullet points, no quotes inside the summary, no emoji.`;

  const userPrompt = `Rewrite this study goal:\n"""${raw.slice(0, MAX_INPUT_CHARS)}"""`;

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

    const summary = extractSummary(rawText);

    if (!summary) {
      console.warn("[polish-goal] empty/unparsable summary", { rawText });
      return NextResponse.json(
        { error: "Couldn't summarise that — please rephrase and try again." },
        { status: 502 }
      );
    }

    // Hard cap — keeps the badge tight even if the model overshoots.
    const capped =
      summary.length > 220
        ? summary.slice(0, 220).replace(/\s+\S*$/, "") + "…"
        : summary;

    return NextResponse.json({ summary: capped });
  } catch (err) {
    console.error("[polish-goal]", err);
    return NextResponse.json(
      { error: "Couldn't reach the AI service. Try again in a moment." },
      { status: 502 }
    );
  }
}
