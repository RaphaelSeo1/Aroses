import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { voiceRules } from "@/lib/ai/study-generation";
import { recordAiUsage } from "@/lib/billing/ai-usage";
import {
  createMarkerParser,
  type LiveNotesStreamEvent,
} from "@/lib/live-notes/marker-protocol";

export type { LiveNotesStreamEvent } from "@/lib/live-notes/marker-protocol";

/**
 * Live Notes synthesis — streaming, grounded, with bounded self-revision.
 *
 * Every ~2.8k chars of fresh transcript, one Haiku call receives: the new
 * slice, the rolling summary, and the last-N AI note sections WITH the raw
 * transcript excerpts they were written from. The model streams a tiny
 * line-marker protocol (parsed incrementally — no waiting for the full
 * response):
 *
 *   @@revise <sectionId>   zero or more, FIRST — full replacement markdown
 *                          for a recent section the model got wrong or that
 *                          new lecture content recontextualizes
 *   @@append               exactly once — new notes for the new slice
 *                          (nothing after it when the slice has no teaching)
 *   @@summary              exactly once, LAST — updated rolling summary
 *                          (withheld from the client, persisted server-side)
 *
 * Markdown subset (shared grammar in `src/lib/notes/notes-markdown.ts`):
 * "## " headings, "- " bullets (one nest level), "1. " steps, "**bold**"
 * key terms, and "> (AI) " for AI-added context the lecturer did NOT say.
 *
 * The rolling summary is re-compressed by the model on every call and
 * hard-capped, so input stays bounded on any lecture length.
 */

const MODEL = process.env.ANTHROPIC_TUTOR_FAST_MODEL?.trim() || "claude-haiku-4-5";

/** Hard cap on the rolling summary we store + send back to the model. */
export const ROLLING_SUMMARY_MAX_CHARS = 1_600;
/** Max transcript slice per call (client triggers around ~2.8k). */
const MAX_SEGMENT_INPUT_CHARS = 12_000;
/** Self-revision context caps (cost bound: ~4 sections/call). */
export const MAX_REVISABLE_SECTIONS = 4;
const MAX_SECTION_MARKDOWN_CHARS = 1_600;
const MAX_SECTION_EXCERPT_CHARS = 2_400;

const NOTE_STYLE_RULES = `You write structured STUDY NOTES, not transcript cleanup:
- Start a "## " heading whenever the lecturer moves to a new topic or concept (3–8 words, not their first sentence; never repeat a RECENT HEADING).
- Bold key terms with **term** on first introduction only.
- State definitions cleanly and precisely, even when the lecturer phrased them loosely — but only from what was said.
- When the lecturer works an example, capture it step-by-step as a numbered list ("1. ", "2. "), using exactly the numbers and steps they used.
- When the lecturer signals importance ("this will be on the exam", "this is the key idea"), add one line: "**Why it matters:** ...".
- Bullets ("- ", one "  - " nesting level for sub-points) for everything else. Concise, declarative prose optimized for understanding and recall — in-depth but digestible. No filler.
- Administrative chatter (attendance, homework logistics, "can everyone see the screen") is NOT teaching content — skip it.

GROUNDING (critical — overrides everything else on conflict):
- Every fact, number, example, and claim must come from the transcript. No outside knowledge, no invented examples, no invented figures (doses, percentages, dates, totals).
- If you add clarifying context the lecturer did NOT say (an analogy, a definition they skipped), it MUST be on its own line formatted exactly as:
  > (AI) <one or two sentences>
  Never blend added context into normal notes.
- If a passage is garbled or ambiguous, omit it. Never guess.`;

const SYSTEM = `You are a meticulous note-taker sitting in a live lecture. You receive: the NEWEST slice of the lecture transcript (raw speech-to-text), a rolling summary of everything covered before it, and YOUR RECENT NOTE SECTIONS with the raw transcript excerpts they were written from.

${NOTE_STYLE_RULES}

${voiceRules()}

SELF-REVISION (bounded):
- Compare each RECENT NOTE SECTION against its transcript excerpt. If YOU misrepresented the lecturer — wrong number, inverted relationship, misattributed claim — or if the NEW transcript slice corrects or recontextualizes a recent section, rewrite that WHOLE section with @@revise.
- The transcript is ground truth. Only revise sections you were given. Do not revise for style or wording preference. If nothing is wrong, emit no revisions. Most calls need none.

WHEN THE NEW SLICE HAS NO NEW TEACHING (small talk, logistics, repeats of the rolling summary): still emit @@append but put NOTHING after it. Never pad.

OUTPUT PROTOCOL — emit exactly this, nothing before the first marker, no code fences, each marker alone on its own line:
@@revise <sectionId>
<full replacement markdown for that section>
(zero or more @@revise operations, always FIRST)
@@append
<markdown study notes for the new slice, or nothing>
@@summary
<updated rolling summary: compressed record of EVERYTHING covered so far (previous summary + this slice), max ${ROLLING_SUMMARY_MAX_CHARS} characters, plain text, no markdown — re-compress aggressively, keep topic names and key terms, drop detail>`;

export type RevisableSection = {
  sectionId: string;
  markdown: string;
  /** Raw transcript excerpt this section was written from (ground truth). */
  transcriptExcerpt?: string;
};

/**
 * Stream one synthesis call. Yields `op` / `text` events for the client and
 * a final `summary` event for the route to persist. Throws on transport
 * errors; the route converts those into an SSE `error` event.
 */
export async function* streamLiveLectureNotes(input: {
  newSegmentText: string;
  rollingSummary: string;
  recentHeadings: string[];
  revisable: RevisableSection[];
  /** Server-assigned id for the section this call appends. */
  appendSectionId: string;
  lectureTitle?: string;
  userId?: string;
}): AsyncGenerator<LiveNotesStreamEvent> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    yield { type: "summary", summary: input.rollingSummary };
    return;
  }

  const slice = input.newSegmentText.trim().slice(0, MAX_SEGMENT_INPUT_CHARS);
  if (slice.length < 200) {
    yield { type: "summary", summary: input.rollingSummary };
    return;
  }

  const summary = input.rollingSummary.trim().slice(0, ROLLING_SUMMARY_MAX_CHARS);
  const headings = input.recentHeadings
    .map((h) => h.trim())
    .filter(Boolean)
    .slice(-5);
  const revisable = input.revisable.slice(-MAX_REVISABLE_SECTIONS);

  const sectionsBlock = revisable
    .map((s) => {
      const parts = [
        `[SECTION ${s.sectionId}]`,
        s.markdown.slice(0, MAX_SECTION_MARKDOWN_CHARS),
      ];
      if (s.transcriptExcerpt?.trim()) {
        parts.push(
          `[TRANSCRIPT EXCERPT this section was written from — ground truth:]`,
          s.transcriptExcerpt.trim().slice(0, MAX_SECTION_EXCERPT_CHARS)
        );
      }
      return parts.join("\n");
    })
    .join("\n\n");

  const userPrompt = [
    input.lectureTitle ? `LECTURE: ${input.lectureTitle.slice(0, 200)}` : null,
    summary
      ? `ROLLING SUMMARY OF THE LECTURE SO FAR:\n${summary}`
      : "ROLLING SUMMARY OF THE LECTURE SO FAR: (lecture just started)",
    headings.length > 0
      ? `RECENT HEADINGS (do not repeat these):\n${headings.map((h) => `- ${h}`).join("\n")}`
      : null,
    sectionsBlock
      ? `YOUR RECENT NOTE SECTIONS (the only sections you may @@revise):\n\n${sectionsBlock}`
      : "YOUR RECENT NOTE SECTIONS: (none yet — no @@revise operations possible)",
    `NEW TRANSCRIPT SLICE (raw speech-to-text — synthesize into study notes, never copy verbatim):\n${slice}`,
    "\nEmit the protocol now, starting with the first marker.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const anthropic = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 1 });
  const stream = anthropic.messages.stream({
    model: MODEL,
    max_tokens: 4_000,
    temperature: 0.3,
    system: SYSTEM,
    messages: [{ role: "user", content: userPrompt }],
  });

  const parser = createMarkerParser(
    new Set(revisable.map((s) => s.sectionId)),
    input.appendSectionId
  );

  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      for (const ev of parser.push(event.delta.text)) yield ev;
    }
  }
  for (const ev of parser.flush()) yield ev;

  try {
    const final = await stream.finalMessage();
    recordAiUsage({
      model: MODEL,
      inputTokens: final.usage?.input_tokens,
      outputTokens: final.usage?.output_tokens,
      feature: "live-notes",
      userId: input.userId ?? null,
    });
  } catch {
    /* usage telemetry only */
  }

  const updated = parser.summaryText();
  yield {
    type: "summary",
    summary: (updated || input.rollingSummary).slice(0, ROLLING_SUMMARY_MAX_CHARS),
  };
}

// ── Wrap-up consistency review (once, on Finish) ─────────────────────────────

const REVIEW_SYSTEM = `You are reviewing AI-generated live-lecture study notes against the full lecture transcript before they are archived. The transcript is ground truth.

For each numbered note section, check every fact, number, relationship, and attribution against the transcript. Return a revision ONLY when a section materially misrepresents the lecture — wrong number, inverted relationship, misattributed claim, or content the lecturer never said outside a "> (AI)" line. Do NOT rewrite for style, ordering, or wording preference. Most sections should need no revision.

Replacement sections use this markdown subset: "## " / "### " headings, "- " bullets ("  - " nested), "1. " numbered steps, "**bold**" key terms, "> (AI) " for AI-added context. ${voiceRules()}

Output ONLY valid JSON (no markdown fences):
{ "revisions": [ { "sectionId": string, "markdown": string } ] }
Return { "revisions": [] } when everything is grounded.`;

const MAX_REVIEW_TRANSCRIPT_CHARS = 60_000;

export async function reviewLiveLectureNotes(input: {
  sections: Array<{ sectionId: string; markdown: string }>;
  transcript: string;
  lectureTitle?: string;
  userId?: string;
}): Promise<Array<{ sectionId: string; markdown: string }> | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || input.sections.length === 0) return null;

  const allowed = new Set(input.sections.map((s) => s.sectionId));
  const sectionsBlock = input.sections
    .map(
      (s) =>
        `[SECTION ${s.sectionId}]\n${s.markdown.slice(0, MAX_SECTION_MARKDOWN_CHARS)}`
    )
    .join("\n\n");

  const userPrompt = [
    input.lectureTitle ? `LECTURE: ${input.lectureTitle.slice(0, 200)}` : null,
    `NOTE SECTIONS TO VERIFY:\n\n${sectionsBlock}`,
    `FULL LECTURE TRANSCRIPT (ground truth):\n${input.transcript.slice(0, MAX_REVIEW_TRANSCRIPT_CHARS)}`,
    "\nReturn the JSON now.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const anthropic = new Anthropic({ apiKey, timeout: 45_000, maxRetries: 1 });
  try {
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2_500,
      temperature: 0.2,
      system: REVIEW_SYSTEM,
      messages: [{ role: "user", content: userPrompt }],
    });
    recordAiUsage({
      model: MODEL,
      inputTokens: msg.usage?.input_tokens,
      outputTokens: msg.usage?.output_tokens,
      feature: "live-notes-review",
      userId: input.userId ?? null,
    });

    const textBlock = msg.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") return null;
    const raw = textBlock.text
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();
    const parsed = JSON.parse(raw) as { revisions?: unknown };
    if (!Array.isArray(parsed.revisions)) return [];
    return parsed.revisions
      .filter(
        (r): r is { sectionId: string; markdown: string } =>
          !!r &&
          typeof r === "object" &&
          typeof (r as { sectionId?: unknown }).sectionId === "string" &&
          allowed.has((r as { sectionId: string }).sectionId) &&
          typeof (r as { markdown?: unknown }).markdown === "string" &&
          ((r as { markdown: string }).markdown.trim().length > 0)
      )
      .slice(0, input.sections.length);
  } catch (e) {
    console.error("[live-lecture-notes] wrap-up review", e);
    return null;
  }
}
