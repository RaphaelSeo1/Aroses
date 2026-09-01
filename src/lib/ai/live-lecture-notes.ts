import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { voiceRules } from "@/lib/ai/study-generation";
import { TUTOR_NOTES_QUALITY_RULES } from "@/lib/ai/tutor-notes-quality";
import { recordAiUsage } from "@/lib/billing/ai-usage";
import {
  createMarkerParser,
  type LiveNotesStreamEvent,
} from "@/lib/live-notes/marker-protocol";
import { buildNoteInstructionModifier } from "@/lib/ai/note-instruction";
import { DECK_DRAFT_EXCERPT } from "@/lib/live-notes/slide-pages";

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
 *   @@revise <sectionId>   new or corrected bullets for an existing section
 *                          (client keeps prior bullets; never a wipe)
 *   @@append               exactly once — genuinely NEW topics only
 *                          (empty when the slice was folded into @@revise)
 *   @@summary              exactly once, LAST — updated rolling summary
 *                          (withheld from the client, persisted server-side)
 *
 * Markdown subset (shared grammar in `src/lib/notes/notes-markdown.ts`):
 * "## " headings, "- " bullets (one nest level), "1. " steps, "**bold**"
 * key terms, GFM pipe tables, and "> (AI) " for AI-added context the lecturer
 * did NOT say.
 *
 * The rolling summary is re-compressed by the model on every call and
 * hard-capped, so input stays bounded on any lecture length.
 */

const MODEL = process.env.ANTHROPIC_TUTOR_FAST_MODEL?.trim() || "claude-haiku-4-5";
/** Same model as tutor-session recaps — lecture Finish recap should match that quality. */
const RECAP_MODEL =
  process.env.ANTHROPIC_TUTOR_MODEL?.trim() || "claude-sonnet-4-6";

/** Hard cap on the rolling summary we store + send back to the model. */
export const ROLLING_SUMMARY_MAX_CHARS = 1_600;
/** Max transcript slice per call (client triggers around ~700). */
const MAX_SEGMENT_INPUT_CHARS = 12_000;
/** Self-revision context caps (cost bound: ~6 sections/call). */
export const MAX_REVISABLE_SECTIONS = 6;
const MAX_EXISTING_HEADINGS = 40;
const MAX_SECTION_MARKDOWN_CHARS = 4_000;
const MAX_SECTION_EXCERPT_CHARS = 2_400;
const MAX_DECK_LIVE_CHARS = 2_400;
const MAX_DECK_SEED_CHARS = 7_000;

const NOTE_STYLE_RULES = `You write structured STUDY NOTES — useful to reread later, not a transcript and not a re-narration of the lecture. Aim for the old thorough default, cleaned up: keep the substance, drop the noise.

- Start a "## " heading whenever the lecturer moves to a distinct topic or concept (3–8 words naming the idea; never repeat an EXISTING NOTE HEADING — fold into that section instead).
- Under each heading, write enough that a student who missed the verbal fluff still understands the point: crisp definitions, key numbers/units, named studies/people/dates, cause→effect, and the load-bearing supporting detail. Prefer a short paragraph or a handful of solid bullets over one telegraphic line.
- SUMMARIZE as you go. New transcript arrives often — do NOT dump every utterance. Fold related sentences into one clear note. Skip filler, hedging, transitions, anecdotes, repetition, and anything that wouldn't help someone study the material.
- Bold key terms with **term** on first introduction only. State definitions cleanly even when the lecturer phrased them loosely — but only from what was said or shown.
- When the lecturer works an example, capture it as a numbered list ("1. ", "2. ") with their actual numbers/steps — keep the steps that teach the method; drop purely verbal padding around them.
- When the slide or lecture shows a comparison grid, drug/dose chart, criteria matrix, or other tabular data, capture it as a GFM pipe table (header row, then a "| --- | --- |" separator, then data rows). Keep cells faithful to what was shown/said — do not invent columns.
- When the lecturer signals importance ("this will be on the exam", "this is the key idea"), add one line: "**Why it matters:** ...". Don't sprinkle it on every section.
- Administrative chatter (attendance, logistics, "can everyone see the screen") is NOT teaching content — skip it.
- Bullets ("- ", one "  - " nesting level for sub-points) for lists of points; short prose when a definition or relationship needs a full sentence. Concise and readable — in-depth where the idea needs it, never padded.

DO NOT under-write by default: if a definition, number, named study/person, result, or worked step was taught, it must appear. Condensing means clearer prose and fewer redundant bullets — not omitting teachable content. If a STUDENT NOTE STYLE is present and asks for shorter, sparser, or less detailed notes, keep only the load-bearing facts they still need and follow that request.

GROUNDING (critical — overrides everything else on conflict):
- You may receive THREE sources: NEW TRANSCRIPT SLICE (speech-to-text), ON-SCREEN CONTENT (OCR/vision from the shared lecture display), and DECK SLIDES (pre-uploaded lecture deck pages matched to this slice).
- Screen text is AUTHORITATIVE for: spellings, symbols, drug/chemical names, numbers, units, table cells, equation symbols, and slide titles — when the conflict is clearly an STT mishear / typo AND the extract is from the current frame.
- DECK SLIDES (matched pages only): use as the lecture's written reference for this topic. Include definitions, formulas, tables, labels, and load-bearing bullets that are on those pages even if the lecturer only gestured at them or the STT garbled them. Do NOT copy slides that are not in DECK SLIDES. Do NOT add textbook knowledge that is not on the matched pages or in the transcript/screen.
- Transcript is AUTHORITATIVE for: spoken explanation, emphasis, worked examples walked verbally, and asides not visible on screen or deck.
- CONTRADICTIONS (do not silently overwrite): If the lecturer says two incompatible things, or live screen and speech disagree on a substantive claim, do NOT invent a winner — @@append:
  - **Open question:** Notes had <prior claim>; just said/shown <new claim>. Which is right?
  Keep both claims visible in that question.
- SLIDE DRAFTS vs SPEECH: Sections drafted from the uploaded deck (transcript excerpt "${DECK_DRAFT_EXCERPT}" or empty excerpt) are provisional. When this slice of speech covers that topic, @@revise the matching section:
  - Lecturer ADDS explanation, examples, emphasis, or "also / next / furthermore" detail → emit ONLY the new spoken bullets. The client keeps every still-correct slide bullet. Additional information is not an error. Never replace the section with only the new slice.
  - Lecturer clearly CONTRADICTS a specific claim ("actually it's X", "not Y", "ignore that") → emit only that corrected bullet. Keep the rest of the section.
  - Lecturer SKIPPED / "ignore this slide" → say so in one bullet; do not wipe the whole section.
  Do not wipe a whole section because one token, comma, or extra clause arrived.
- Do NOT @@revise for: grammar, punctuation, capitalization, articles, near-identical rephrasing, STT/OCR flicker, or a slightly different wording of the same fact. Those are not errors.
- Clear STT/spelling token-fix only (slide shows the drug name, transcript garbled it): @@revise with that one corrected bullet — not the rest of the section.
- If ON-SCREEN CONTENT is missing or empty, prefer DECK SLIDES for spellings/numbers of the current topic; if both are missing, every fact must come from the transcript alone.
- OCR/screen extracts can change every few seconds. A new OCR dump that overlaps the same slide is NOT a reason to rewrite. Only use screen text to fix a spelling/number when it is clearly more reliable than STT.
- No outside knowledge, no invented examples, no invented figures (doses, percentages, dates, totals).
- If you add clarifying context the lecturer did NOT say or show (an analogy, a definition they skipped), it MUST be on its own line formatted exactly as:
  > (AI) <one or two sentences>
  Never blend added context into normal notes.
- If a passage is garbled or ambiguous in BOTH sources, omit it. Never guess.`;

const SYSTEM = `You are a meticulous note-taker sitting in a live lecture. You receive: the NEWEST slice of the lecture transcript (raw speech-to-text), optional ON-SCREEN CONTENT extracted from the shared display, optional DECK SLIDES (pre-uploaded pages matched to this slice), a rolling summary of everything covered before it, and YOUR RECENT NOTE SECTIONS with the raw transcript excerpts they were written from.

${NOTE_STYLE_RULES}

${voiceRules()}

SELF-REVISION / CONTINUATION (notes from slides or earlier slices already exist — do not wipe them):
Before writing, check EXISTING NOTE HEADINGS and YOUR RECENT NOTE SECTIONS. If the NEW TRANSCRIPT SLICE continues, completes, repeats, or is about the same topic as a section that is already written (same concept, same worked example, remaining items of an enumeration — match by meaning, not only exact heading text):

- You MUST @@revise that sectionId. Under @@revise emit ONLY the new or corrected bullets — do NOT repeat the whole section. The client keeps every existing bullet and folds your lines in. A full rewrite that drops earlier facts is always wrong.
- Do NOT @@append a new section that restates or continues that topic. A second copy at the bottom is always wrong when the notes already exist.
- If you are unsure whether it is the same topic, @@revise the closest matching listed section rather than appending.

Only @@append when the slice introduces a topic that has NO matching existing heading.

- If the slice only REPEATS already-captured material → leave @@append empty (still emit the marker). Do NOT @@revise just to rephrase.
- NEVER @@revise for grammar, punctuation, capitalization, filler words, or OCR/STT flicker.
- Narrow factual fix only (lecturer said "not 3mg, 30mg"): @@revise with that one corrected bullet, not the rest of the section.
- Slide DRAFTS (transcript excerpt is "${DECK_DRAFT_EXCERPT}"): speech about that topic MUST @@revise with the added spoken detail only. Additional information is additive. Do NOT treat "here's more on this" as "delete the draft."
- Other substantive contradictions (two incompatible things the lecturer said, or live screen vs speech): do NOT pick a winner — @@append an **Open question:** line instead.

Only sections in YOUR RECENT NOTE SECTIONS may be revised. If a matching heading exists but that id is not in YOUR RECENT NOTE SECTIONS, leave @@append empty rather than duplicating it. At most one @@revise per call.

NARRATION (@@thought — user-visible, optional but valuable):
- You MAY emit zero or one short @@thought line before @@revise/@@append. This is Rose speaking to the student in the activity log — not notes.
- Prefer a thought when ON-SCREEN CONTENT has something useful, there is a clear topic shift, or you are flagging an open question / contradiction.
- Skip @@thought for logistics, silence, or tiny filler.
- Voice: warm, specific, varied — under 18 words. Never invent screen content that was not provided.
- Do not say "error", "mismatch", or "didn't hold up" unless the lecturer clearly retracted a fact. For extra detail, say you are adding it to that section.
- Never emit more than one @@thought per call.

WHEN THE NEW SLICE HAS NO NEW TEACHING (small talk, logistics, repeats of the rolling summary): still emit @@append but put NOTHING after it. Never pad.

OUTPUT PROTOCOL — emit exactly this, nothing before the first marker, no code fences, each marker alone on its own line:
@@thought <optional one short sentence — skip if unnecessary>
@@revise <sectionId>
<ONLY new or corrected bullets for that section — never a wipe / full restatement>
(at most one @@revise, after @@thought; omit the marker when unused)
@@append
<markdown for genuinely new teaching and/or **Open question:** lines, or nothing when the slice was folded into @@revise or was a repeat>
@@summary
<updated rolling summary: compressed record of EVERYTHING covered so far (previous summary + this slice), max ${ROLLING_SUMMARY_MAX_CHARS} characters, plain text, no markdown — re-compress aggressively, keep topic names and key terms, drop detail>`;

const SEED_SYSTEM = `You are drafting study notes from a pre-uploaded lecture slide deck BEFORE any speech has been transcribed. There is no lecture audio yet.

${NOTE_STYLE_RULES}

${voiceRules()}

SEED RULES (override live-lecture habits):
- Source of truth is DECK SLIDES only. Cover every slide in that block. Do not skip a slide because it looks like an agenda or recap — capture the teachable content.
- Do NOT use outside/textbook knowledge. If a slide is sparse, write a short heading + the bullets that are actually there; do not invent explanations.
- Do NOT emit @@revise. Always @@append (notes for this batch of slides).
- Structure with "## " headings per topic (not automatically one heading per slide). Include formulas, definitions, tables, and load-bearing labels from the slides.
- If RECENT HEADINGS already cover a topic from an earlier seed batch, do not repeat that H2 — continue under a more specific facet heading only when this batch adds a distinct idea.
- @@thought: one short line that you are drafting from the uploaded slides (mention slide numbers if present).
- @@summary: compressed record of topics drafted so far (previous summary + these slides).

OUTPUT PROTOCOL — emit exactly this, nothing before the first marker, no code fences, each marker alone on its own line:
@@thought <one short sentence>
@@append
<markdown study notes for these slides>
@@summary
<updated rolling summary, max ${ROLLING_SUMMARY_MAX_CHARS} characters, plain text, no markdown>`;

/**
 * Layer the student's per-session note request directly under the base style
 * rules. Empty instruction ⇒ the exact base SYSTEM, byte-for-byte.
 * REVIEW_SYSTEM is intentionally never modified — the wrap-up review is
 * factual/structural.
 */
function liveNotesSystem(
  noteInstruction: string | undefined,
  mode: "live" | "seed"
): string {
  const base = mode === "seed" ? SEED_SYSTEM : SYSTEM;
  const modifier = buildNoteInstructionModifier(noteInstruction);
  if (!modifier) return base;
  return base.replace(NOTE_STYLE_RULES, `${NOTE_STYLE_RULES}${modifier}`);
}

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
  /** All already-written H2s (id + title) so the model can avoid duplicates. */
  existingHeadings?: Array<{ sectionId: string; heading: string }>;
  revisable: RevisableSection[];
  /** Server-assigned id for the section this call appends. */
  appendSectionId: string;
  lectureTitle?: string;
  userId?: string;
  /** Recent on-screen extracts (slide OCR) — authoritative for spellings/numbers. */
  screenContext?: string;
  /** Matched pages from a pre-uploaded deck (not the whole file). */
  deckContext?: string;
  /** Per-session free-text style request. Empty/missing ⇒ base SYSTEM unchanged. */
  noteInstruction?: string;
  /** Draft notes from the uploaded deck before any speech. */
  mode?: "live" | "seed";
}): AsyncGenerator<LiveNotesStreamEvent> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    yield { type: "summary", summary: input.rollingSummary };
    return;
  }

  const mode = input.mode === "seed" ? "seed" : "live";
  const slice = input.newSegmentText.trim().slice(0, MAX_SEGMENT_INPUT_CHARS);
  // Seed drafts from slides with no speech. Live calls still need a real slice.
  if (mode !== "seed" && slice.length < 80) {
    yield { type: "summary", summary: input.rollingSummary };
    return;
  }
  if (mode === "seed" && !(input.deckContext ?? "").trim()) {
    yield { type: "summary", summary: input.rollingSummary };
    return;
  }

  const summary = input.rollingSummary.trim().slice(0, ROLLING_SUMMARY_MAX_CHARS);
  const headings = input.recentHeadings
    .map((h) => h.trim())
    .filter(Boolean)
    .slice(-8);
  const existingHeadings = (input.existingHeadings ?? [])
    .filter(
      (h) =>
        typeof h.sectionId === "string" &&
        h.sectionId.trim() &&
        typeof h.heading === "string" &&
        h.heading.trim()
    )
    .slice(0, MAX_EXISTING_HEADINGS);
  const revisable =
    mode === "seed" ? [] : input.revisable.slice(0, MAX_REVISABLE_SECTIONS);
  // Keep screen context tight — large dumps encourage unnecessary rewrites.
  const screenContext =
    mode === "seed" ? "" : (input.screenContext ?? "").trim().slice(0, 1_800);
  const deckRaw = (input.deckContext ?? "").trim();
  const deckCap = mode === "seed" ? MAX_DECK_SEED_CHARS : MAX_DECK_LIVE_CHARS;
  const deckText = deckRaw.slice(0, deckCap);

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

  const hasDraft =
    revisable.some((s) =>
      (s.transcriptExcerpt ?? "").includes(DECK_DRAFT_EXCERPT)
    );

  const userPrompt =
    mode === "seed"
      ? [
          input.lectureTitle
            ? `LECTURE: ${input.lectureTitle.slice(0, 200)}`
            : null,
          summary
            ? `ROLLING SUMMARY OF TOPICS DRAFTED SO FAR:\n${summary}`
            : "ROLLING SUMMARY OF TOPICS DRAFTED SO FAR: (none yet)",
          headings.length > 0
            ? `RECENT HEADINGS already drafted (do not repeat these H2s):\n${headings.map((h) => `- ${h}`).join("\n")}`
            : null,
          `DECK SLIDES (draft study notes covering ALL of these pages; no outside knowledge):\n${deckText}`,
          "NO SPEECH YET. Draft from the slides only.",
          "\nEmit the protocol now. @@append notes for this batch. Do not @@revise.",
        ]
          .filter(Boolean)
          .join("\n\n")
      : [
          input.lectureTitle
            ? `LECTURE: ${input.lectureTitle.slice(0, 200)}`
            : null,
          summary
            ? `ROLLING SUMMARY OF THE LECTURE SO FAR:\n${summary}`
            : "ROLLING SUMMARY OF THE LECTURE SO FAR: (lecture just started)",
          existingHeadings.length > 0
            ? `EXISTING NOTE HEADINGS (already written — if this slice is the same topic, @@revise that id when it is in YOUR RECENT NOTE SECTIONS; never @@append a second copy at the bottom):\n${existingHeadings.map((h) => `- [${h.sectionId}] ${h.heading}`).join("\n")}`
            : headings.length > 0
              ? `RECENT HEADINGS (do not spawn a near-duplicate H2 for the same topic — fold new detail into that section):\n${headings.map((h) => `- ${h}`).join("\n")}`
              : null,
          sectionsBlock
            ? `YOUR RECENT NOTE SECTIONS (the only sections you may @@revise — fold speech into these instead of appending a duplicate):\n\n${sectionsBlock}`
            : "YOUR RECENT NOTE SECTIONS: (none yet — no @@revise operations possible)",
          screenContext
            ? `ON-SCREEN CONTENT (authoritative for spellings/symbols/numbers/tables — use for grounding; do NOT revise prior notes merely because the screen changed):\n${screenContext}`
            : null,
          deckText
            ? `DECK SLIDES (pre-uploaded pages matched to this slice — fill in formulas, definitions, tables, and labels from THESE pages even if only half-said; do not copy other slides; no outside knowledge):\n${deckText}`
            : null,
          `NEW TRANSCRIPT SLICE (raw speech-to-text — synthesize into study notes, never copy verbatim):\n${slice}`,
          hasDraft
            ? "\nEmit the protocol now. If this speech covers a slide-drafted section, @@revise with ONLY the new spoken bullets (keep nothing you would delete). The client preserves every still-correct bullet. Additional information is not an error. @@append ONLY for a topic that has no matching existing heading. Empty @@append when the slice was folded in or is a repeat."
            : "\nEmit the protocol now. If notes already exist for this topic, @@revise with ONLY the new or corrected bullets — do not rewrite the whole section. @@append ONLY for a genuinely new topic with no matching heading. Empty @@append when the slice was folded in or is a repeat. **Open question:** only for unclear contradictions in speech/screen.",
        ]
          .filter(Boolean)
          .join("\n\n");

  const anthropic = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 1 });
  const stream = anthropic.messages.stream({
    model: MODEL,
    max_tokens: mode === "seed" ? 5_000 : 4_000,
    temperature: 0.35,
    system: liveNotesSystem(input.noteInstruction, mode),
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

const REVIEW_SYSTEM = `You are reviewing AI-generated live-lecture study notes against the full lecture transcript AND optional on-screen extracts AND optional pre-uploaded deck text before they are archived.

Priority for clear STT/spelling issues: current-frame screen text wins for spellings, symbols, proper names, and table cells. Pre-uploaded deck text may supply the same for the topic being discussed. Transcript wins for spoken explanation and emphasis.

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

Replacement / merged sections use this markdown subset: "## " / "### " headings, "- " bullets ("  - " nested), "1. " numbered steps, "**bold**" key terms, GFM pipe tables ("| col |" + "| --- |" separator), "> (AI) " for AI-added context, and "- **Open question:** …" for unresolved conflicts. ${voiceRules()}

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
  /** Optional pre-uploaded deck text. */
  deckContent?: string;
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
  const deck = (input.deckContent ?? "").trim();
  const userPrompt = [
    input.lectureTitle ? `LECTURE: ${input.lectureTitle.slice(0, 200)}` : null,
    `NOTE SECTIONS TO VERIFY (document order — earliest first):\n\n${sectionsBlock}`,
    screen
      ? `ON-SCREEN CONTENT (authoritative for spellings/numbers/tables):\n${screen.slice(0, MAX_REVIEW_SCREEN_CHARS)}`
      : null,
    deck
      ? `DECK SLIDES (pre-uploaded lecture deck — spellings/formulas/tables for topics that were discussed):\n${deck.slice(0, MAX_REVIEW_SCREEN_CHARS)}`
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

// ── End-of-lecture recap (once, on Finish) — same shape as tutor-session recaps ─

const LECTURE_RECAP_SYSTEM = `You generate a polished, study-ready RECAP from a live lecture transcript (and optional on-screen extracts and a pre-uploaded slide deck). Output MARKDOWN — proper headings, bullets, callouts, bold for key terms, and GFM pipe tables when the lecture showed comparison grids or charts.

${TUTOR_NOTES_QUALITY_RULES}

This is a LECTURE (spoken teaching + slides), not a 1:1 tutor chat. Ground every claim in the transcript, on-screen content, and/or uploaded deck pages that were taught — no outside textbook knowledge, no invented facts/numbers/names. Deck pages may fill in formulas/definitions the lecturer pointed at but did not fully read aloud. Do not recap slides that were never discussed.

STRUCTURE (use this EXACTLY):

# {Emoji} {Title}

> *Live lecture · {Approx duration} · {Date}*

## Overview
{2-3 sentence summary of what the lecture covered and the main thread a student should remember.}

## What we covered
{For each major topic, an H3 section. Under each:
- Brief concept explanation (1-2 sentences)
- A bullet list of key takeaways, with **bold** lead-ins for key terms
- Worked examples if the lecturer walked them (use code blocks for formulas / equations)
- A > callout block for any "remember this" / exam-trap moment the lecturer flagged
}

## Key terms
{A definition list of important terms from the lecture. Format as:
- **Term** — definition.}

## Self-check questions
{3-5 questions the student can use to verify retention later. Mix of conceptual and applied. Grounded in what was actually taught.}

## What to study next
{2-4 specific next steps tied to natural follow-ups from this lecture (or gaps the lecturer flagged). Each as a bullet starting with a verb.}

STYLE RULES:
- Polished but warm. Sound like a thoughtful TA wrote the recap — same quality as a tutor-session recap.
- Concise — better tight and readable than long and waffly.
- NO generic filler. Every section should be specific to what THIS lecture taught.
- Use ONE emoji in the H1 title that matches the topic.
- Skip sections that aren't relevant (e.g. no worked-example bullets if none were discussed).
- Compression is lossless on facts: keep key definitions, decisive numbers/units, named studies/people/dates, and cause→effect.`;

/**
 * One Sonnet call → tutor-session-style lecture recap markdown.
 * Returns null when the model/key is unavailable or the transcript is too thin.
 */
export async function summarizeLiveLecture(input: {
  transcript: string;
  screenContent?: string;
  deckContent?: string;
  lectureTitle?: string;
  /** Optional existing note markdown — coverage guide only, not a new fact source. */
  notesOutline?: string;
  durationSeconds?: number | null;
  startedAt?: string | null;
  userId?: string;
}): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const transcript = input.transcript.trim();
  if (!apiKey || transcript.length < 80) return null;

  const duration =
    input.durationSeconds && input.durationSeconds > 0
      ? `${Math.round(input.durationSeconds / 60)} min`
      : "—";
  const dateStr = input.startedAt
    ? new Date(input.startedAt).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : new Date().toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });

  const screen = (input.screenContent ?? "").trim();
  const deck = (input.deckContent ?? "").trim();
  const outline = (input.notesOutline ?? "").trim();
  const userPrompt = [
    `TITLE HINT: ${input.lectureTitle?.trim() || "Live lecture"}`,
    `DURATION: ${duration}`,
    `DATE: ${dateStr}`,
    outline
      ? `EXISTING LIVE NOTES (coverage guide only — do not invent beyond transcript/screen/deck):\n"""\n${outline.slice(0, 6_000)}\n"""`
      : null,
    screen
      ? `ON-SCREEN CONTENT (authoritative for spellings/numbers/tables):\n"""\n${screen.slice(0, MAX_REVIEW_SCREEN_CHARS)}\n"""`
      : null,
    deck
      ? `DECK SLIDES (pre-uploaded lecture deck — fill in formulas/definitions for topics that were taught):\n"""\n${deck.slice(0, MAX_REVIEW_SCREEN_CHARS)}\n"""`
      : null,
    `FULL LECTURE TRANSCRIPT:\n"""\n${transcript.slice(0, MAX_REVIEW_TRANSCRIPT_CHARS)}\n"""`,
    "\nGenerate the recap now. Start with the H1 title.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const anthropic = new Anthropic({ apiKey, timeout: 90_000, maxRetries: 1 });
  try {
    const msg = await anthropic.messages.create({
      model: RECAP_MODEL,
      max_tokens: 2_500,
      temperature: 0.4,
      system: LECTURE_RECAP_SYSTEM,
      messages: [{ role: "user", content: userPrompt }],
    });
    recordAiUsage({
      model: RECAP_MODEL,
      inputTokens: msg.usage?.input_tokens,
      outputTokens: msg.usage?.output_tokens,
      feature: "live-notes-lecture-recap",
      userId: input.userId ?? null,
    });

    const textBlock = msg.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") return null;
    const raw = textBlock.text
      .replace(/^```(?:markdown|md)?\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();
    if (!raw || raw.length < 80) return null;
    return raw.slice(0, 40_000);
  } catch (e) {
    console.error("[live-lecture-notes] lecture recap", e);
    return null;
  }
}
