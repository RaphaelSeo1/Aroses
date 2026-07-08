import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { AutoGenerateBlock } from "@/components/immersive/NotesPanel";
import { normalizeBlock } from "@/lib/ai/synthesize-tutor-notes";
import { voiceRules } from "@/lib/ai/study-generation";
import { recordAiUsage } from "@/lib/billing/ai-usage";

/**
 * Live Notes synthesis: turns the newest slice of a live lecture transcript
 * into ONE structured notes section (`AutoGenerateBlock`, same shape the
 * NotesPanel already appends) plus an updated rolling summary.
 *
 * Cost model: called ~once every 2–3 minutes of speech. The rolling summary
 * is re-compressed by the model on every call and hard-capped, so the input
 * stays bounded no matter how long the lecture runs.
 */

const MODEL = process.env.ANTHROPIC_TUTOR_FAST_MODEL?.trim() || "claude-haiku-4-5";

/** Hard cap on the rolling summary we store + send back to the model. */
export const ROLLING_SUMMARY_MAX_CHARS = 1_600;
/** Max transcript slice per call (client triggers around ~2.8k). */
const MAX_SEGMENT_INPUT_CHARS = 12_000;

const SYSTEM = `You are a meticulous note-taker sitting in a live lecture. You receive the NEWEST slice of the lecture transcript (raw speech-to-text) plus a rolling summary of everything covered before it. You produce ONE structured study-notes section for the student's live notebook, and an updated rolling summary.

LECTURE GROUNDING (critical — these override everything else on conflict):
- The notes must contain ONLY what the lecturer actually said in the transcript. No outside knowledge, no invented figures, names, dates, formulas, or examples.
- Do not "improve" or correct the lecturer's content. If the transcript is garbled or ambiguous on a point, leave that point out — never guess.
- Do NOT invent specific numbers (doses, percentages, dates, totals) unless they appear in the transcript slice.
- Administrative chatter (attendance, homework logistics, "can everyone see the screen") is NOT teaching content — skip it.

${voiceRules()}

WHEN TO RETURN NO SECTION:
- If the new transcript slice contains no substantive new teaching (small talk, logistics, a repeat of what the rolling summary already covers), return "block": null. This is a correct and common answer.
- Never pad: an empty vocabulary/selfCheck is better than an invented one.

SECTION STRUCTURE (when there IS new teaching):
- heading: short topic title (3–8 words) for what was just taught — not the lecturer's first sentence. Must NOT duplicate any of the RECENT HEADINGS provided.
- intro: 1–2 sentences framing the section (optional).
- bullets: 3–8 substantive bullets with bold key terms; nested children for steps or contrasts.
- examples: only when the lecturer worked through math/calculations — reproduce THEIR numbers exactly.
- vocabulary: 0–5 terms the lecturer explicitly defined.
- callout: one "remember this" takeaway ONLY if the lecturer emphasized a trap or exam point.
- Omit selfCheck (this is live capture, not a recap).

ROLLING SUMMARY:
- updatedSummary = compressed record of EVERYTHING covered so far (previous summary + this slice), max ${ROLLING_SUMMARY_MAX_CHARS} characters. Re-compress aggressively; keep topic names and key terms, drop detail. Plain text, no markdown.

Output ONLY valid JSON (no markdown fences):
{
  "block": { "heading": string, "emoji": string?, "intro": string?, "bullets": [string | {"text": string, "bold": string?, "children": string[]?}], "examples": [{"label": string?, "content": string}]?, "vocabulary": [{"term": string, "definition": string?}]?, "callout": {"emoji": string?, "text": string}? } | null,
  "updatedSummary": string
}`;

function stripJsonFence(s: string): string {
  return s
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

export async function synthesizeLiveLectureNotes(input: {
  newSegmentText: string;
  rollingSummary: string;
  recentHeadings: string[];
  lectureTitle?: string;
  userId?: string;
}): Promise<{ block: AutoGenerateBlock | null; updatedSummary: string } | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const slice = input.newSegmentText.trim().slice(0, MAX_SEGMENT_INPUT_CHARS);
  if (slice.length < 200) {
    return { block: null, updatedSummary: input.rollingSummary };
  }

  const summary = input.rollingSummary.trim().slice(0, ROLLING_SUMMARY_MAX_CHARS);
  const headings = input.recentHeadings
    .map((h) => h.trim())
    .filter(Boolean)
    .slice(-5);

  const userPrompt = [
    input.lectureTitle ? `LECTURE: ${input.lectureTitle.slice(0, 200)}` : null,
    summary
      ? `ROLLING SUMMARY OF THE LECTURE SO FAR:\n${summary}`
      : "ROLLING SUMMARY OF THE LECTURE SO FAR: (lecture just started)",
    headings.length > 0
      ? `RECENT HEADINGS (do not repeat these):\n${headings.map((h) => `- ${h}`).join("\n")}`
      : null,
    `NEW TRANSCRIPT SLICE (raw speech-to-text — synthesize, never copy verbatim):\n${slice}`,
    "\nReturn the JSON now.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const anthropic = new Anthropic({ apiKey, timeout: 45_000, maxRetries: 1 });

  try {
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1_600,
      temperature: 0.3,
      system: SYSTEM,
      messages: [{ role: "user", content: userPrompt }],
    });
    recordAiUsage({
      model: MODEL,
      inputTokens: msg.usage?.input_tokens,
      outputTokens: msg.usage?.output_tokens,
      feature: "live-notes",
      userId: input.userId ?? null,
    });

    const textBlock = msg.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(stripJsonFence(textBlock.text));
    } catch {
      console.error(
        "[live-lecture-notes] invalid JSON",
        textBlock.text.slice(0, 200)
      );
      return null;
    }

    const o = parsed as { block?: unknown; updatedSummary?: unknown };
    const block = o.block == null ? null : normalizeBlock(o.block);
    const updatedSummary =
      typeof o.updatedSummary === "string" && o.updatedSummary.trim()
        ? o.updatedSummary.trim().slice(0, ROLLING_SUMMARY_MAX_CHARS)
        : summary;

    return { block, updatedSummary };
  } catch (e) {
    console.error("[live-lecture-notes]", e);
    return null;
  }
}
