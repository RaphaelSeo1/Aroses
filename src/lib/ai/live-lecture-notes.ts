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
 * Every ~450 chars of fresh transcript (~30s of speech; the client runs a
 * 5s cadence heartbeat), one Haiku call receives: the new slice, the
 * rolling summary, and the last-N AI note sections WITH the raw transcript
 * excerpts they were written from. The model streams a tiny
 * line-marker protocol (parsed incrementally — no waiting for the full
 * response):
 *
 *   @@thought <text>       zero or more, FIRST — short user-visible narration
 *                          (specific to this slice; may call out on-screen finds)
 *   @@revise <sectionId>   rare — full replacement ONLY for factual errors
 *                          in a recent section (not for continuations)
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
/** Max transcript slice per call (client triggers around ~700). */
const MAX_SEGMENT_INPUT_CHARS = 12_000;
/** Self-revision context caps (cost bound: ~4 sections/call). */
export const MAX_REVISABLE_SECTIONS = 4;
const MAX_SECTION_MARKDOWN_CHARS = 1_600;
const MAX_SECTION_EXCERPT_CHARS = 2_400;

const NOTE_STYLE_RULES = `You write structured STUDY NOTES, not transcript cleanup:
- Start a "## " heading whenever the lecturer moves to a new topic or concept (3–8 words, not their first sentence; never repeat a RECENT HEADING).
- Bold key terms with **term** on first introduction only.
- State definitions cleanly and precisely, even when the lecturer phrased them loosely — but only from what was said or shown.
- When the lecturer works an example, capture it step-by-step as a numbered list ("1. ", "2. "), using exactly the numbers and steps they used.
- When the lecturer signals importance ("this will be on the exam", "this is the key idea"), add one line: "**Why it matters:** ...".
- Bullets ("- ", one "  - " nesting level for sub-points) for everything else. Concise, declarative prose optimized for understanding and recall — in-depth but digestible. No filler.
- Administrative chatter (attendance, homework logistics, "can everyone see the screen") is NOT teaching content — skip it.

GROUNDING (critical — overrides everything else on conflict):
- You may receive TWO sources: NEW TRANSCRIPT SLICE (speech-to-text) and ON-SCREEN CONTENT (OCR/vision from the shared lecture display).
- Screen text is AUTHORITATIVE for: spellings, symbols, drug/chemical names, numbers, units, table cells, equation symbols, and slide titles — when the conflict is clearly an STT mishear / typo.
- Transcript is AUTHORITATIVE for: spoken explanation, emphasis, worked examples walked verbally, and asides not visible on screen.
- CONTRADICTIONS (do not silently overwrite): If the new slice or screen conflicts with what a recent note already said — or speech and screen disagree on a substantive claim (not just spelling) — do NOT delete or rewrite the prior note away. Instead @@append a short open question so the student can decide, using exactly this shape on its own line:
  - **Open question:** Notes had <prior claim>; just said/shown <new claim>. Which is right?
  Keep both claims visible in that question. Never invent a third "resolved" answer.
- Clear STT/spelling fixes only (e.g. slide shows the correct drug name, transcript garbled it): you may fix that token via a minimal @@revise, or write the correct spelling in the new append without wiping the section.
- If ON-SCREEN CONTENT is missing or empty, every fact must come from the transcript alone (legacy behavior).
- No outside knowledge, no invented examples, no invented figures (doses, percentages, dates, totals).
- If you add clarifying context the lecturer did NOT say or show (an analogy, a definition they skipped), it MUST be on its own line formatted exactly as:
  > (AI) <one or two sentences>
  Never blend added context into normal notes.
- If a passage is garbled or ambiguous in BOTH sources, omit it. Never guess.`;

const SYSTEM = `You are a meticulous note-taker sitting in a live lecture. You receive: the NEWEST slice of the lecture transcript (raw speech-to-text), optional ON-SCREEN CONTENT extracted from the shared display, a rolling summary of everything covered before it, and YOUR RECENT NOTE SECTIONS with the raw transcript excerpts they were written from.

${NOTE_STYLE_RULES}

${voiceRules()}

SELF-REVISION (rare — preserve prior notes):
Default to @@append for new teaching content. Do NOT rewrite an existing section just because the topic continues, a new slide appeared, the screen refreshed, or something sounds different.

Use @@revise <sectionId> ONLY for a minimal fix when something is genuinely wrong in a narrow way:
- clear spelling / symbol / proper-name STT error (prefer the slide token),
- an unambiguous inverted relationship or wrong number the lecturer clearly corrected as a mistake,
- content that was never said/shown and is not inside a "> (AI)" or "**Open question:**" line.

When revising, change ONLY the wrong token(s) or the one wrong bullet — keep the rest of the section verbatim. Do not restyle or reorganize.

Do NOT use @@revise to:
- resolve a substantive contradiction (append an **Open question:** instead),
- continue or "complete" a topic (append the new points instead),
- merge, tidy, or rewrite for style,
- react to a new slide when the prior section is still fine.

When the slice continues the same topic as a recent heading: @@append with a more specific heading for the new facet — do not invent a near-duplicate H2 for the exact same topic, and do not revise the old section just to fold new bullets in.

When the slice only repeats already-captured material: leave @@append empty (still emit the marker).

Only sections in YOUR RECENT NOTE SECTIONS may be revised. Never touch older/unshown sections. At most one @@revise per call.

NARRATION (@@thought — user-visible, optional but valuable):
- You MAY emit zero or one short @@thought line before @@revise/@@append. This is Rose speaking to the student in the activity log — not notes.
- Prefer a thought when ON-SCREEN CONTENT has something useful, there is a clear topic shift, or you are flagging an open question / contradiction.
- Skip @@thought for logistics, silence, or tiny filler.
- Voice: warm, specific, varied — under 18 words. Never invent screen content that was not provided.
- Never emit more than one @@thought per call.

WHEN THE NEW SLICE HAS NO NEW TEACHING (small talk, logistics, repeats of the rolling summary): still emit @@append but put NOTHING after it. Never pad.

OUTPUT PROTOCOL — emit exactly this, nothing before the first marker, no code fences, each marker alone on its own line:
@@thought <optional one short sentence — skip if unnecessary>
@@revise <sectionId>
<full section markdown with ONLY the minimal factual/spelling fix — usually omit @@revise entirely>
(zero or more @@revise operations, after @@thought lines; usually none)
@@append
<markdown for new teaching and/or **Open question:** lines, or nothing>
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
  /** Recent on-screen extracts (slide OCR) — authoritative for spellings/numbers. */
  screenContext?: string;
}): AsyncGenerator<LiveNotesStreamEvent> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    yield { type: "summary", summary: input.rollingSummary };
    return;
  }

  const slice = input.newSegmentText.trim().slice(0, MAX_SEGMENT_INPUT_CHARS);
  // Lower floor so smaller, more frequent batches still synthesize.
  if (slice.length < 80) {
    yield { type: "summary", summary: input.rollingSummary };
    return;
  }

  const summary = input.rollingSummary.trim().slice(0, ROLLING_SUMMARY_MAX_CHARS);
  const headings = input.recentHeadings
    .map((h) => h.trim())
    .filter(Boolean)
    .slice(-5);
  const revisable = input.revisable.slice(-MAX_REVISABLE_SECTIONS);
  // Keep screen context tight — large dumps encourage unnecessary rewrites.
  const screenContext = (input.screenContext ?? "").trim().slice(0, 1_800);

  const sectionsBlock = revisable
    .map((s) => {
      const parts = [
        `[SECTION ${s.sectionId}]`,
        s.markdown.slice(0, MAX_SECTION_MARKDOWN_CHARS),
      ];
      if (s.transcriptExcerpt?.trim()) {
        parts.push(
          `[TRANSCRIPT EXCERPT this section was written from:]`,
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
      ? `RECENT HEADINGS (avoid near-duplicate H2s for the same topic — append a more specific facet heading instead of revising the old section):\n${headings.map((h) => `- ${h}`).join("\n")}`
      : null,
    sectionsBlock
      ? `YOUR RECENT NOTE SECTIONS (the only sections you may @@revise):\n\n${sectionsBlock}`
      : "YOUR RECENT NOTE SECTIONS: (none yet — no @@revise operations possible)",
    screenContext
      ? `ON-SCREEN CONTENT (authoritative for spellings/symbols/numbers/tables — use for grounding; do NOT revise prior notes merely because the screen changed):\n${screenContext}`
      : null,
    `NEW TRANSCRIPT SLICE (raw speech-to-text — synthesize into study notes, never copy verbatim):\n${slice}`,
    "\nEmit the protocol now. Prefer @@append (including **Open question:** for contradictions). Use @@revise only for a minimal spelling/genuine-error fix.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const anthropic = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 1 });
  const stream = anthropic.messages.stream({
    model: MODEL,
    max_tokens: 4_000,
    temperature: 0.35,
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

const REVIEW_SYSTEM = `You are reviewing AI-generated live-lecture study notes against the full lecture transcript AND optional on-screen extracts before they are archived.

Priority for clear STT/spelling issues: screen text wins for spellings, symbols, proper names, and table cells. Transcript wins for spoken explanation and emphasis.

Do TWO jobs:

1) FACTUAL / SPELLING FIXES — Return a revision ONLY when a section has a clear, narrow error:
   - STT/spelling/symbol/proper-name mistake (prefer the slide token),
   - an unambiguous wrong number or inverted relationship the lecture clearly establishes,
   - content that was never said/shown (outside "> (AI)" or "**Open question:**" lines).
   When revising, keep the rest of the section verbatim — minimal token/bullet fixes only.
   SUBSTANTIVE CONTRADICTIONS (lecture said A earlier and B later, or speech vs slide disagree on meaning): do NOT pick a winner or delete either claim. Instead revise that section (or leave it and rely on an existing open question) so both sides remain visible as:
   - **Open question:** Notes had <A>; later said/shown <B>. Which is right?
   Never invent a resolved answer.

2) STRUCTURAL CONSOLIDATION — Detect duplicate or fragmented AI sections that cover the same topic, the same worked example, or pieces of one interrupted enumeration/list split across sections. Merge each group into ONE canonical section:
   - Keep the EARLIEST section's sectionId (first in document order among the group).
   - Fold unique grounded content from the absorbed sections into that kept section's markdown (no redundancy, no invented facts). Preserve any **Open question:** lines.
   - List every absorbed sectionId in removeSectionIds (never list the kept id).
   - If two sections are near-duplicates by meaning (reworded headings for the same topic), treat them as one group.
   Do NOT remove a section merely because it conflicts with another — flag with an open question instead unless it is a pure duplicate.

Do NOT invent facts. Do NOT rewrite purely for style when nothing is wrong and nothing needs merging. Student-owned sections are not in the input — ignore anything not listed.

Replacement / merged sections use this markdown subset: "## " / "### " headings, "- " bullets ("  - " nested), "1. " numbered steps, "**bold**" key terms, "> (AI) " for AI-added context, and "- **Open question:** …" for unresolved conflicts. ${voiceRules()}

Output ONLY valid JSON (no markdown fences):
{ "revisions": [ { "sectionId": string, "markdown": string } ], "removeSectionIds": [ string ] }
Return { "revisions": [], "removeSectionIds": [] } when everything is grounded and already consolidated.`;

const MAX_REVIEW_TRANSCRIPT_CHARS = 60_000;
const MAX_REVIEW_SCREEN_CHARS = 20_000;

export type LiveNotesReviewResult = {
  revisions: Array<{ sectionId: string; markdown: string }>;
  removeSectionIds: string[];
};

export async function reviewLiveLectureNotes(input: {
  sections: Array<{ sectionId: string; markdown: string }>;
  transcript: string;
  /** Optional concatenated on-screen extracts. */
  screenContent?: string;
  lectureTitle?: string;
  userId?: string;
}): Promise<LiveNotesReviewResult | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || input.sections.length === 0) return null;

  const allowed = new Set(input.sections.map((s) => s.sectionId));
  const sectionsBlock = input.sections
    .map(
      (s) =>
        `[SECTION ${s.sectionId}]\n${s.markdown.slice(0, MAX_SECTION_MARKDOWN_CHARS)}`
    )
    .join("\n\n");

  const screen = (input.screenContent ?? "").trim();
  const userPrompt = [
    input.lectureTitle ? `LECTURE: ${input.lectureTitle.slice(0, 200)}` : null,
    `NOTE SECTIONS TO VERIFY (document order — earliest first):\n\n${sectionsBlock}`,
    screen
      ? `ON-SCREEN CONTENT (authoritative for spellings/numbers/tables):\n${screen.slice(0, MAX_REVIEW_SCREEN_CHARS)}`
      : null,
    `FULL LECTURE TRANSCRIPT:\n${input.transcript.slice(0, MAX_REVIEW_TRANSCRIPT_CHARS)}`,
    "\nReturn the JSON now. When merging, keep the earliest sectionId and list absorbed ids in removeSectionIds.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const anthropic = new Anthropic({ apiKey, timeout: 45_000, maxRetries: 1 });
  try {
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 3_500,
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
    const parsed = JSON.parse(raw) as {
      revisions?: unknown;
      removeSectionIds?: unknown;
    };

    const revisions = Array.isArray(parsed.revisions)
      ? parsed.revisions
          .filter(
            (r): r is { sectionId: string; markdown: string } =>
              !!r &&
              typeof r === "object" &&
              typeof (r as { sectionId?: unknown }).sectionId === "string" &&
              allowed.has((r as { sectionId: string }).sectionId) &&
              typeof (r as { markdown?: unknown }).markdown === "string" &&
              ((r as { markdown: string }).markdown.trim().length > 0)
          )
          .slice(0, input.sections.length)
      : [];

    const removeSectionIds = Array.isArray(parsed.removeSectionIds)
      ? [
          ...new Set(
            parsed.removeSectionIds.filter(
              (id): id is string =>
                typeof id === "string" &&
                allowed.has(id) &&
                !revisions.some((r) => r.sectionId === id)
            )
          ),
        ].slice(0, input.sections.length)
      : [];

    return { revisions, removeSectionIds };
  } catch (e) {
    console.error("[live-lecture-notes] wrap-up review", e);
    return null;
  }
}
