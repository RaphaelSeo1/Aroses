import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { voiceRules } from "@/lib/ai/study-generation";
import {
  DEFAULT_NOTES_OUTLINE_RULES,
  SEED_THOROUGHNESS_RULES,
  SOURCE_CONFIDENCE_RULES,
  TUTOR_NOTES_QUALITY_RULES,
  UNIFIED_NOTES_RULES,
} from "@/lib/ai/tutor-notes-quality";
import { buildConceptCoverageBlock } from "@/lib/notes/concept-coverage";
import {
  applySemanticTrims,
  consolidateRepeatedExplanations,
  findSemanticTrimCandidates,
  formatSemanticTrimCandidates,
  parseSemanticTrimJson,
  REPEATED_EXPLANATIONS_JOB_RULES,
  SEMANTIC_TRIM_INSTRUCTION,
} from "@/lib/notes/cross-section-dedupe";
import { recordAiUsage } from "@/lib/billing/ai-usage";
import {
  createMarkerParser,
  type LiveNotesStreamEvent,
} from "@/lib/live-notes/marker-protocol";
import { buildNoteInstructionModifier } from "@/lib/ai/note-instruction";
import { DECK_DRAFT_EXCERPT } from "@/lib/live-notes/slide-pages";
import {
  buildSectionsOutline,
  findDuplicateTopicGroups,
  mergeDuplicateGroup,
} from "@/lib/live-notes/fold-note-markdown";
import { isOverCutRevision, selectDeckExcerptFor } from "@/lib/live-notes/review-guards";
import { MAX_REVISABLE_SECTIONS } from "@/lib/live-notes/revisable-limits";

export type { LiveNotesStreamEvent } from "@/lib/live-notes/marker-protocol";
export { MAX_REVISABLE_SECTIONS } from "@/lib/live-notes/revisable-limits";

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
 *   @@revise <sectionId>   zero or more — new/corrected bullets per section
 *                          (client keeps prior bullets; never a wipe)
 *   @@delete <sectionId>   zero or more — exact lines to remove (duplicates/wrong)
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

/**
 * Hard cap on the rolling summary we store + send back to the model. The
 * summary carries concept STATE (defined / explained / mentioned), not just
 * topic names, so later slices can tell a mention from a re-explanation.
 */
export const ROLLING_SUMMARY_MAX_CHARS = 2_000;
/** Cap for the deterministic concept-coverage block in each prompt. */
const MAX_CONCEPT_COVERAGE_CHARS = 2_200;
/** Max transcript slice per call (client triggers around ~700). */
const MAX_SEGMENT_INPUT_CHARS = 12_000;
/** Self-revision context caps (cost bound: ~10 focused sections/call). */
const MAX_EXISTING_HEADINGS = 200;
const MAX_SECTION_MARKDOWN_CHARS = 4_000;
/** Cap total full-markdown chars across focused revisable sections. */
const MAX_REVISABLE_TOTAL_CHARS = 28_000;
const MAX_SECTION_EXCERPT_CHARS = 2_400;
const MAX_DECK_LIVE_CHARS = 2_400;
const MAX_DECK_SEED_CHARS = 7_000;

const NOTE_STYLE_RULES = `You write structured STUDY NOTES — useful to reread later, not a transcript and not a re-narration of the lecture. Aim for the old thorough default, cleaned up: keep the substance, drop the noise.

${TUTOR_NOTES_QUALITY_RULES}

${DEFAULT_NOTES_OUTLINE_RULES}

${UNIFIED_NOTES_RULES}

${SOURCE_CONFIDENCE_RULES}

- Start a "## " heading whenever the lecturer moves to a distinct topic or concept (3–8 words naming the idea; never repeat an EXISTING NOTE HEADING — fold into that section instead).
- Every non-empty @@append MUST begin with a "## " topic heading. Under it, use the normal outline: a framing paragraph when supported, then grouped top-level bullets with **bold lead-ins** and "  - " nested supporting details. Use "### " only for a real subtopic such as a worked example or comparison—not generic boilerplate. Never emit an unheaded run of flat bullets.
- Under each heading, write enough that a student who missed the verbal fluff still understands the point: crisp definitions, key numbers/units, named studies/people/dates, cause→effect, and the load-bearing supporting detail. Prefer coherent prose plus grouped/nested bullets over one bullet per utterance.
- CONSOLIDATE as you go — condense wording, never information. New transcript arrives often; do NOT transcribe every utterance, and do fold related sentences about one point into one clear note. Skip filler, hedging, transitions, verbatim repetition, and administrative chatter. Never skip a fact, number, example, mechanism, qualification, or step to save space: each of those gets its own line or nested detail.
- Bold key terms with **term** on first introduction only. State definitions cleanly even when the lecturer phrased them loosely — but only from what was said or shown.
- When the lecturer works an example, capture it as a numbered list ("1. ", "2. ") with their actual numbers/steps — keep the steps that teach the method; drop purely verbal padding around them.
- When the slide or lecture shows a comparison grid, drug/dose chart, criteria matrix, or other tabular data, capture it as a GFM pipe table (header row, then a "| --- | --- |" separator, then data rows). Keep cells faithful to what was shown/said — do not invent columns.
- When the lecturer signals importance ("this will be on the exam", "this is the key idea"), add one line: "**Why it matters:** ...". Don't sprinkle it on every section.
- Administrative chatter (attendance, logistics, "can everyone see the screen") is NOT teaching content — skip it.
- Bullets ("- ", one "  - " nesting level for sub-points) for lists of points; short prose when a definition or relationship needs a full sentence. Group related details beneath a parent bullet instead of extending one long flat list. Concise and readable — in-depth where the idea needs it, never padded.

DO NOT under-write by default: if a definition, number, named study/person, result, or worked step was taught, it must appear. Condensing means clearer prose and fewer redundant bullets — not omitting teachable content. If a STUDENT NOTE STYLE is present and asks for shorter, sparser, or less detailed notes, keep only the load-bearing facts they still need and follow that request.

GROUNDING (critical — overrides everything else on conflict):
- You may receive THREE sources: NEW TRANSCRIPT SLICE (speech-to-text), ON-SCREEN CONTENT (OCR/vision from the shared lecture display), and DECK SLIDES (pre-uploaded lecture deck pages matched to this slice).
- Screen text is AUTHORITATIVE for: spellings, symbols, drug/chemical names, numbers, units, table cells, equation symbols, and slide titles — when the conflict is clearly an STT mishear / typo AND the extract is from the current frame.
- DECK SLIDES (matched pages only): use as the lecture's written reference for this topic. Include definitions, formulas, tables, labels, and load-bearing bullets that are on those pages even if the lecturer only gestured at them or the STT garbled them. Do NOT copy slides that are not in DECK SLIDES. Do NOT add textbook knowledge that is not on the matched pages or in the transcript/screen.
- Transcript is AUTHORITATIVE for: spoken explanation, emphasis, worked examples walked verbally, and asides not visible on screen or deck.
- CONTRADICTIONS: First apply the source priorities above. If current screen/deck clearly resolves an STT error, or the lecturer explicitly corrects/retracts the prior claim, @@revise the matching section with only the corrected line. If the available sources do not establish a winner, do NOT invent one: @@revise the matching section with:
  - **Open question:** Notes had <prior claim>; just said/shown <new claim>. Which is right?
  Keep both claims visible in that question. Only use @@append when there is no matching existing section.
- SLIDE DRAFTS vs SPEECH: Sections drafted from the uploaded deck (transcript excerpt "${DECK_DRAFT_EXCERPT}" or empty excerpt) are provisional. When this slice of speech covers that topic, @@revise the matching section:
  - Lecturer ADDS explanation, examples, emphasis, or "also / next / furthermore" detail → emit ONLY the new structured fragment (paragraph, grouped/nested bullets, or meaningful H3). The client keeps every still-correct slide content. Additional information is not an error. Never replace the section with only the new slice.
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

SELF-REVISION / CONTINUATION (notes from uploaded material, slides, or earlier slices already exist — do not wipe them):
Before writing, check ALL EXISTING NOTE SECTIONS, not just recent live output. If the NEW TRANSCRIPT SLICE continues, completes, repeats, or is about the same topic as a section that is already written (same concept, same worked example, remaining items of an enumeration — match by meaning, not only exact heading text):

- You MUST @@revise that sectionId. Under @@revise emit ONLY a structured Markdown fragment containing the new or corrected material—never repeat the "## " heading or the whole section. The client surgically folds your fragment into the existing section.
- Preserve the section's organization. A single related fact can be one bullet; multiple supporting details should use a bold parent bullet with nested "  - " children, a short paragraph, or a meaningful "### " subtopic. Do not grow a long flat list one utterance at a time.
- Do not emit generic "Key vocabulary" / "Self-check" subsections during a continuation unless the incoming lecture material itself makes them useful.
- Do NOT @@append a new section that restates or continues that topic. A second copy at the bottom is always wrong when the notes already exist.
- If you are unsure whether it is the same topic, @@revise the closest matching listed section rather than appending.

Only @@append when the slice introduces a topic that has NO matching existing heading.

- Leave @@append empty ONLY when every sentence of the slice restates something the notes already contain, with no new fact, number, example, exception, qualification, or step (still emit the marker). A slice that revisits a known concept but adds any such detail is NOT a repeat — capture the detail via @@revise. Do NOT @@revise just to rephrase.
- CONCEPT COVERAGE is the document's memory of what is ESTABLISHED — it is not a list of finished topics and never a cap on how much may be written about a concept. When the lecturer returns to a concept listed as DEFINED/EXPLAINED, decide per sentence: same content already captured → nothing; any new fact/example/mechanism/stage/number/exception/qualification/emphasis → @@revise the OWNING section listed there with that line (every new detail, not a selection); only a topic with no owning section anywhere gets @@append. Never write a fresh definition of a covered concept inside another section — a short "recall that …" clause is the most you may add.
- NEVER @@revise for grammar, punctuation, capitalization, filler words, or OCR/STT flicker.
- Narrow factual fix only (lecturer said "not 3mg, 30mg"): @@revise with that one corrected bullet, not the rest of the section.
- Slide DRAFTS (transcript excerpt is "${DECK_DRAFT_EXCERPT}"): speech about that topic MUST @@revise with the added spoken detail only. Additional information is additive. Do NOT treat "here's more on this" as "delete the draft."
- Other substantive contradictions: resolve only when the supplied source priority or an explicit correction establishes the answer; otherwise @@revise the matching section with an **Open question:** line. Never append a duplicate contradictory section.

Any listed sectionId may be revised or targeted by @@delete. For a section marked PRESERVE EXISTING WORDING, emit only the exact new or corrected lines under @@revise; never rewrite or remove the rest; ignore @@delete for those sections (the client will too). You MAY emit multiple @@revise blocks in one call when the slice touches several existing sections — one block per sectionId, each followed by its own fragment.

@@delete <sectionId>: use ONLY to remove exact duplicate or clearly wrong lines (body = those exact lines, one per line). Prefer a one-line "not covered / skipped" bullet under @@revise when the lecturer skips a slide. Do not @@delete whole sections.

NARRATION (@@thought — user-visible, optional but valuable):
- You MAY emit zero or one short @@thought line before @@revise/@@append. This is Rose speaking to the student in the activity log — not notes.
- Prefer a thought when ON-SCREEN CONTENT has something useful, there is a clear topic shift, or you are flagging an open question / contradiction.
- Skip @@thought for logistics, silence, or tiny filler.
- Voice: warm, specific, varied — under 18 words. Never invent screen content that was not provided.
- Do not say "error", "mismatch", or "didn't hold up" unless the lecturer clearly retracted a fact. For extra detail, say you are adding it to that section.
- Never emit more than one @@thought per call.

WHEN THE NEW SLICE HAS NO NEW TEACHING (small talk, logistics, a verbatim repeat of material the notes already hold with no added detail): still emit @@append but put NOTHING after it. Never pad. A slice that revisits a known topic with even one new detail is not "no new teaching" — that detail goes into @@revise.

OUTPUT PROTOCOL — emit exactly this, nothing before the first marker, no code fences, each marker alone on its own line:
@@thought <optional one short sentence — skip if unnecessary>
@@revise <sectionId>
<ONLY a structured fragment of new/corrected material; no H2 and never a wipe/full restatement>
(zero or more @@revise blocks; omit when unused)
@@delete <sectionId>
<exact lines to remove; omit the marker when unused>
@@append
<markdown for genuinely new teaching and/or **Open question:** lines; leave the body empty when the slice was folded into @@revise or was a repeat>
@@summary
<updated rolling summary, max ${ROLLING_SUMMARY_MAX_CHARS} characters, plain text, no markdown. It is a CONCEPT STATE record, not prose: "TOPICS: <topic names in order>. DEFINED: <concept — 3-6 word gist>; … EXPLAINED: <concept — gist>; … MENTIONED ONLY: <concepts named but not yet explained>. OPEN: <unresolved questions / things the lecturer said are coming later>." Merge the previous summary with this slice; re-compress this SUMMARY aggressively (this applies to the rolling summary only — never to the notes themselves, which must stay complete); never drop a concept from DEFINED/EXPLAINED once it is there.>`;

/**
 * Seed-mode overrides: slide decks must stay thorough. Live redundancy rules
 * (fold / skip restatements) otherwise turn a multi-page deck into a thin
 * synopsis once early batches populate CONCEPT COVERAGE.
 */
export { SEED_THOROUGHNESS_RULES };

const SEED_SYSTEM = `You are drafting study notes from a pre-uploaded lecture slide deck BEFORE any speech has been transcribed. There is no lecture audio yet.

${NOTE_STYLE_RULES}

${voiceRules()}

${SEED_THOROUGHNESS_RULES}

SEED RULES (override live-lecture habits):
- Source of truth is DECK SLIDES only. Cover teachable content on those pages. Do not invent explanations.
- Do NOT use outside/textbook knowledge. If a slide is sparse, write a short heading + the bullets that are actually there.
- SOURCE FIDELITY: every note line must be traceable to a line on these slides. A bare term or figure label on a slide becomes a bare (bolded) term in the notes — never an explanation the slide does not give. Do not add background, definitions, consequences, comparisons, or examples the slides do not state, even when you know them; a scientifically correct line that is not on the slides misrepresents this lecture. Keep the slides' own key terms and abbreviations exactly as written.
- You receive an OUTLINE of sections already drafted from earlier batches. Continue those topics via @@revise with new lines; do not @@append a second copy of the same topic heading.
- @@append for genuinely NEW topics or distinct facets that have no matching outline entry.
- Slides with no extractable text: emit nothing after the markers (empty @@append). Never write sentences about the slides, extraction, OCR, or future updates.
- Structure with "## " headings per topic — not automatically one heading per slide, but never one heading for the whole deck either. When a batch opens a distinct facet (a new mechanism, stage, experiment, comparison, application, or set of examples), give it its own "## " heading instead of growing one section past roughly a dozen top-level bullets. Include formulas, definitions, tables, and load-bearing labels from the slides.
- COVERAGE CONTRACT: every sentence, number, name, comparison, exception, and mechanism on these slides must land in a @@revise or @@append line. Compress wording, never drop content; the notes are audited slide-by-slide afterwards and anything skipped is copied back in verbatim.
- @@thought: one short line that you are drafting from the uploaded slides (mention slide numbers if present).
- @@summary: concept-state record of what has been drafted so far (previous summary + these slides).

OUTPUT PROTOCOL — emit exactly this, nothing before the first marker, no code fences, each marker alone on its own line:
@@thought <one short sentence>
@@revise <sectionId>
<ONLY new lines for an already-drafted topic; omit the marker when unused; you MAY emit multiple @@revise blocks>
@@append
<markdown for NEW topics / distinct facets; leave the body empty only when every teachable line on these slides is already in the notes or the slides had nothing to draft>
@@summary
<updated rolling summary, max ${ROLLING_SUMMARY_MAX_CHARS} characters, plain text, no markdown, in the same CONCEPT STATE format: "TOPICS: …. DEFINED: <concept — gist>; … EXPLAINED: …. MENTIONED ONLY: …. OPEN: …">`;

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
  /** Existing wording must be preserved; only surgical changes are allowed. */
  studentEdited?: boolean;
  /** Raw transcript excerpt this section was written from (ground truth). */
  transcriptExcerpt?: string;
};

export type ExistingLiveNoteSection = {
  sectionId: string;
  markdown: string;
  /** The section contains imported, student-authored, or student-edited blocks. */
  studentEdited?: boolean;
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
  /** Full addressable note document, including imported/material sections. */
  existingSections?: ExistingLiveNoteSection[];
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
  // Seed may revise already-drafted sections; live focuses top-N by relevance.
  const revisable = input.revisable.slice(0, MAX_REVISABLE_SECTIONS);
  const existingSections = input.existingSections ?? [];
  // Keep screen context tight — large dumps encourage unnecessary rewrites.
  const screenContext =
    mode === "seed" ? "" : (input.screenContext ?? "").trim().slice(0, 1_800);
  const deckRaw = (input.deckContext ?? "").trim();
  const deckCap = mode === "seed" ? MAX_DECK_SEED_CHARS : MAX_DECK_LIVE_CHARS;
  const deckText = deckRaw.slice(0, deckCap);

  // Bound full-markdown dump: outline of ALL sections + full text only for
  // the focused revisable set (char-capped).
  const outlineBlock =
    existingSections.length > 0
      ? buildSectionsOutline(existingSections)
      : existingHeadings.length > 0
        ? existingHeadings
            .map((h) => `[${h.sectionId}] ${h.heading}`)
            .join("\n")
        : "";

  let revisableChars = 0;
  const sectionsBlock = revisable
    .flatMap((s) => {
      const room = MAX_REVISABLE_TOTAL_CHARS - revisableChars;
      if (room < 80) return [];
      const md = s.markdown.slice(
        0,
        Math.min(MAX_SECTION_MARKDOWN_CHARS, room)
      );
      revisableChars += md.length;
      const parts = [
        `[SECTION ${s.sectionId}${s.studentEdited ? " — PRESERVE EXISTING WORDING; surgical additions/corrections only" : ""}]`,
        md,
      ];
      if (s.transcriptExcerpt?.trim()) {
        parts.push(
          `[TRANSCRIPT EXCERPT this section was written from:]`,
          s.transcriptExcerpt.trim().slice(0, MAX_SECTION_EXCERPT_CHARS)
        );
      }
      return [parts.join("\n")];
    })
    .join("\n\n");

  const hasDraft =
    revisable.some((s) =>
      (s.transcriptExcerpt ?? "").includes(DECK_DRAFT_EXCERPT)
    );

  // Deterministic concept state derived from the whole document (not just the
  // focused sections): which concepts are already defined/explained, where,
  // and the gist — ranked by relevance to this slice and char-capped.
  const coverageSource =
    existingSections.length > 0 ? existingSections : revisable;
  const coverageBlock = buildConceptCoverageBlock(coverageSource, {
    relevanceText: mode === "seed" ? deckText : slice,
    maxChars: MAX_CONCEPT_COVERAGE_CHARS,
  });
  const coveragePrompt = coverageBlock
    ? mode === "seed"
      ? `CONCEPT COVERAGE (what earlier batches already ESTABLISH — this is background you must not re-define verbatim; it is NOT a list of finished topics and never a cap on how much to write. Capture EVERY new fact, formula, example, step, number, unit, distinction, exception, table cell, or mechanism from THESE slides about these concepts via @@revise into the owning [sectionId], or @@append a distinct facet heading when substantial):\n${coverageBlock}`
      : `CONCEPT COVERAGE (what the notes ALREADY establish — do not write a second definition or second full explanation of the same content. It is NOT a list of finished topics: DO add every new fact, example, mechanism, stage, number, exception, qualification, or instructor emphasis about these concepts, and put them in the owning [sectionId] via @@revise when they belong there):\n${coverageBlock}`
    : null;

  const userPrompt =
    mode === "seed"
      ? [
          input.lectureTitle
            ? `LECTURE: ${input.lectureTitle.slice(0, 200)}`
            : null,
          summary
            ? `ROLLING SUMMARY OF TOPICS DRAFTED SO FAR:\n${summary}`
            : "ROLLING SUMMARY OF TOPICS DRAFTED SO FAR: (none yet)",
          outlineBlock
            ? `ALREADY-DRAFTED SECTION OUTLINE (if this batch continues one of these topics, @@revise that id with only the NEW lines from these slides; @@append a distinct facet when needed; never @@append a duplicate of the same heading):\n${outlineBlock}`
            : null,
          coveragePrompt,
          sectionsBlock
            ? `FOCUSED SECTION BODIES (full markdown for revise targets):\n\n${sectionsBlock}`
            : null,
          `DECK SLIDES (draft thorough study notes covering teachable content on EVERY page below; no outside knowledge):\n${deckText || "(no extractable text on these slides)"}`,
          "NO SPEECH YET. Draft from the slides only. Empty / logistics-only slides: empty @@append. Review/key-concept slides: capture uncovered teachable lines. Do not thin a multi-page deck into a short synopsis.",
          "\nEmit the protocol now. @@revise matched topics with every new teachable line from these slides; @@append for new topics/facets. Leave bodies empty ONLY when every teachable line on these pages is already drafted. Before @@summary, re-read every slide in this batch: any sentence, number, name, comparison, or mechanism that has not landed in a @@revise or @@append must be added now.",
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
          outlineBlock
            ? `ALL EXISTING NOTE SECTIONS (outline — compare this slice against ALL of them; @@revise the matching id instead of duplicating):\n${outlineBlock}`
            : headings.length > 0
              ? `RECENT HEADINGS (do not spawn a near-duplicate H2 for the same topic — fold new detail into that section):\n${headings.map((h) => `- ${h}`).join("\n")}`
              : null,
          coveragePrompt,
          sectionsBlock
            ? `MOST RELEVANT NOTE SECTIONS (full markdown + source excerpts when available):\n\n${sectionsBlock}`
            : null,
          screenContext
            ? `ON-SCREEN CONTENT (authoritative for spellings/symbols/numbers/tables — use for grounding; do NOT revise prior notes merely because the screen changed):\n${screenContext}`
            : null,
          deckText
            ? `DECK SLIDES (pre-uploaded pages matched to this slice — fill in formulas, definitions, tables, and labels from THESE pages even if only half-said; do not copy other slides; no outside knowledge):\n${deckText}`
            : null,
          `NEW TRANSCRIPT SLICE (raw speech-to-text — synthesize into study notes, never copy verbatim):\n${slice}`,
          hasDraft
            ? "\nEmit the protocol now. If this speech covers slide-drafted section(s), @@revise each matching id with ONLY the new structured fragment (keep nothing you would delete; no H2). You may emit multiple @@revise blocks. The client preserves every still-correct block. Additional information is not an error. @@append ONLY for a topic that has no matching existing heading, and every non-empty append must use the default heading + framing prose + grouped/nested points outline. Leave the @@append body empty when the slice was folded in via @@revise or restates existing notes with no new detail. Every new fact in this slice must land somewhere."
            : "\nEmit the protocol now. If notes already exist for this topic, @@revise with ONLY a structured fragment of the new or corrected material (no H2; do not rewrite the whole section). Multiple @@revise blocks are allowed when several sections are touched. @@append ONLY for a genuinely new topic with no matching heading, and every non-empty append must use the default heading + framing prose + grouped/nested points outline. Leave the @@append body empty when the slice was folded in via @@revise or restates existing notes with no new detail. Every new fact in this slice must land somewhere. **Open question:** only for unclear contradictions in speech/screen.",
        ]
          .filter(Boolean)
          .join("\n\n");

  const anthropic = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 1 });
  const stream = anthropic.messages.stream({
    model: MODEL,
    // Seed batches cover up to ~6 dense slides — need enough room to draft
    // them thoroughly. Live slices stay tighter.
    max_tokens: mode === "seed" ? 8_000 : 4_000,
    temperature: 0.35,
    system: liveNotesSystem(input.noteInstruction, mode),
    messages: [{ role: "user", content: userPrompt }],
  });

  const allowedIds = new Set([
    ...revisable.map((s) => s.sectionId),
    ...existingSections.map((s) => s.sectionId),
  ]);
  const parser = createMarkerParser(allowedIds, input.appendSectionId);

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

Do the job you are asked for:

1) FACTUAL / SPELLING FIXES — Return a revision ONLY when a section has a clear, narrow error:
   - STT/spelling/symbol/proper-name mistake (prefer the slide token),
   - an unambiguous wrong number or inverted relationship the lecture clearly establishes,
   - a line the sources positively CONTRADICT (outside "> (AI)" or "**Open question:**" lines).
   When revising, keep the rest of the section verbatim — minimal token/bullet fixes only. A revision must contain every line of the original except the one(s) you fixed; a shorter section is not a fix.
   The transcript, screen, and deck excerpts you receive may be PARTIAL (long decks are excerpted per batch, the lecturer may not have spoken about every slide, the recording may have started late). Absence from the excerpt is NEVER evidence that a line is wrong: never delete, shorten, or "tidy" a line because you cannot find it in the sources. Slide-drafted notes stand on the deck even when the transcript never mentions them.
   CONSISTENCY (same call): if the batch names one concept two different ways, gives two different numbers for the same quantity, or orders the same sequence differently, fix it ONLY when transcript/screen/deck clearly supports one version (use the source's own term); otherwise add one **Open question:** line. Do not "fix" wording that merely varies.
   UNCERTAIN TOKENS: a term/number that is garbled in speech and absent from screen/deck must not be normalized into a confident technical term — leave it as an **Open question:** line or drop the non-load-bearing detail.
   SUBSTANTIVE CONTRADICTIONS (lecture said A earlier and B later, or speech vs slide disagree on meaning): do NOT pick a winner or delete either claim. Instead revise that section (or leave it and rely on an existing open question) so both sides remain visible as:
   - **Open question:** Notes had <A>; later said/shown <B>. Which is right?
   Never invent a resolved answer.

2) STRUCTURAL CONSOLIDATION — When given a candidate duplicate group, merge into ONE canonical section:
   - Keep the EARLIEST section's sectionId (first in document order among the group).
   - Fold unique grounded content from the absorbed sections into that kept section's markdown (no redundancy, no invented facts). Preserve any **Open question:** lines.
   - List every absorbed sectionId in removeSectionIds (never list the kept id).
   - If two sections are near-duplicates by meaning (reworded headings for the same topic), treat them as one group.
   Do NOT remove a section merely because it conflicts with another — flag with an open question instead unless it is a pure duplicate.

${REPEATED_EXPLANATIONS_JOB_RULES}

Do NOT invent facts. Do NOT rewrite purely for style when nothing is wrong and nothing needs merging. Student-owned sections are not in the input — ignore anything not listed.

Replacement / merged sections use this markdown subset: "## " / "### " headings, "- " bullets ("  - " nested), "1. " numbered steps, "**bold**" key terms, GFM pipe tables ("| col |" + "| --- |" separator), "> (AI) " for AI-added context, and "- **Open question:** …" for unresolved conflicts. ${voiceRules()}

Output ONLY valid JSON (no markdown fences). For jobs 1 and 2:
{ "revisions": [ { "sectionId": string, "markdown": string } ], "removeSectionIds": [ string ] }
Return { "revisions": [], "removeSectionIds": [] } when everything is grounded and already consolidated.
For job 3:
{ "trims": [ { "sectionId": string, "dropLineNumbers": number[] } ] }
Return { "trims": [] } when every later line adds something new.`;

const MAX_REVIEW_TRANSCRIPT_CHARS = 60_000;
const MAX_REVIEW_SCREEN_CHARS = 20_000;
const MAX_REVIEW_SECTIONS_PER_BATCH = 8;
/** Below this much speech the factual pass has nothing to check notes against. */
const MIN_REVIEW_TRANSCRIPT_CHARS = 400;
/** Sections longer than this are context-only in the factual pass (never truncated into a revision). */
const MAX_REVIEW_SECTION_CHARS = 12_000;

export type LiveNotesReviewResult = {
  revisions: Array<{ sectionId: string; markdown: string }>;
  removeSectionIds: string[];
};

function parseReviewJson(
  rawText: string,
  allowed: Set<string>,
  maxRevisions: number
): LiveNotesReviewResult {
  const raw = rawText
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
        .slice(0, maxRevisions)
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
      ].slice(0, maxRevisions)
    : [];

  return { revisions, removeSectionIds };
}

async function callReviewModel(input: {
  systemExtra: string;
  userPrompt: string;
  allowed: Set<string>;
  maxRevisions: number;
  userId?: string;
}): Promise<LiveNotesReviewResult | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const anthropic = new Anthropic({ apiKey, timeout: 45_000, maxRetries: 1 });
  try {
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 3_500,
      temperature: 0.2,
      system: `${REVIEW_SYSTEM}\n\n${input.systemExtra}`,
      messages: [{ role: "user", content: input.userPrompt }],
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
    return parseReviewJson(textBlock.text, input.allowed, input.maxRevisions);
  } catch (e) {
    console.error("[live-lecture-notes] wrap-up review", e);
    return null;
  }
}

/**
 * ONE bounded Haiku call for meaning-level redundancy the deterministic pass
 * could not prove (same idea, different wording). Input is only the compact
 * candidate excerpts — never the whole document or transcript. Skipped when
 * there are no candidates or no API key. Returns validated trims only, and
 * `applySemanticTrims` still refuses any line that carries a number / named
 * term / mostly-new content the owner lines lack.
 */
async function trimRepeatedExplanationsWithModel(input: {
  sections: Array<{ sectionId: string; markdown: string; studentEdited?: boolean }>;
  lectureTitle?: string;
  userId?: string;
}): Promise<{ sections: typeof input.sections; changed: boolean }> {
  const candidates = findSemanticTrimCandidates(input.sections);
  if (candidates.length === 0 || !process.env.ANTHROPIC_API_KEY) {
    return { sections: input.sections, changed: false };
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const anthropic = new Anthropic({ apiKey, timeout: 45_000, maxRetries: 1 });
  const userPrompt = [
    input.lectureTitle ? `LECTURE: ${input.lectureTitle.slice(0, 200)}` : null,
    `CANDIDATES (job 3 — REPEATED EXPLANATIONS):\n\n${formatSemanticTrimCandidates(candidates).slice(0, 14_000)}`,
    `\n${SEMANTIC_TRIM_INSTRUCTION}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  try {
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1_200,
      temperature: 0.1,
      system: `${REVIEW_SYSTEM}\n\nThis call is job 3 (REPEATED EXPLANATIONS) only.`,
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
    if (!textBlock || textBlock.type !== "text") {
      return { sections: input.sections, changed: false };
    }
    const trims = parseSemanticTrimJson(textBlock.text, candidates);
    return applySemanticTrims(input.sections, trims, candidates);
  } catch (e) {
    console.error("[live-lecture-notes] repeated-explanation trim", e);
    return { sections: input.sections, changed: false };
  }
}

export async function reviewLiveLectureNotes(input: {
  sections: Array<{ sectionId: string; markdown: string }>;
  transcript: string;
  /** Optional concatenated on-screen extracts. */
  screenContent?: string;
  /** Optional pre-uploaded deck text. */
  deckContent?: string;
  lectureTitle?: string;
  userId?: string;
  /**
   * When set, skip deterministic pre-merge and only run factual review on
   * the provided sections (used for chunked factual passes).
   */
  factualOnly?: boolean;
}): Promise<LiveNotesReviewResult | null> {
  if (input.sections.length === 0) return null;

  const allRevisions: Array<{ sectionId: string; markdown: string }> = [];
  const allRemoves = new Set<string>();

  // 1) Deterministic duplicate groups → merge (baseline), optionally refine
  //    with a small LLM batch per group.
  if (!input.factualOnly) {
    const groups = findDuplicateTopicGroups(input.sections);
    for (const group of groups) {
      const baseline = mergeDuplicateGroup(group);
      const neighborIds = new Set([
        baseline.sectionId,
        ...baseline.removeSectionIds,
      ]);
      const idx = input.sections.findIndex(
        (s) => s.sectionId === group.keep.sectionId
      );
      const neighborSections = input.sections.filter((s, i) => {
        if (neighborIds.has(s.sectionId)) return true;
        return idx >= 0 && Math.abs(i - idx) === 1;
      });

      const allowed = new Set(neighborSections.map((s) => s.sectionId));
      const sectionsBlock = neighborSections
        .map(
          (s) =>
            `[SECTION ${s.sectionId}]\n${s.markdown.slice(0, MAX_SECTION_MARKDOWN_CHARS)}`
        )
        .join("\n\n");

      const screen = (input.screenContent ?? "").trim();
      const deck = (input.deckContent ?? "").trim();
      const userPrompt = [
        input.lectureTitle
          ? `LECTURE: ${input.lectureTitle.slice(0, 200)}`
          : null,
        `CANDIDATE DUPLICATE GROUP (keep earliest ${baseline.sectionId}; absorb ${baseline.removeSectionIds.join(", ") || "(none)"}):\n\n${sectionsBlock}`,
        screen
          ? `ON-SCREEN CONTENT:\n${screen.slice(0, Math.min(8_000, MAX_REVIEW_SCREEN_CHARS))}`
          : null,
        deck
          ? `DECK SLIDES:\n${deck.slice(0, Math.min(8_000, MAX_REVIEW_SCREEN_CHARS))}`
          : null,
        `TRANSCRIPT EXCERPT:\n${input.transcript.slice(0, 12_000)}`,
        "\nMerge this group only. Return JSON with the kept section revision and removeSectionIds for absorbed ids.",
      ]
        .filter(Boolean)
        .join("\n\n");

      const llm = await callReviewModel({
        systemExtra:
          "This call is STRUCTURAL CONSOLIDATION only for the candidate group. Prefer merging; do not invent facts.",
        userPrompt,
        allowed,
        maxRevisions: neighborSections.length,
        userId: input.userId,
      });

      // The deterministic baseline is the union of the group's lines. A model
      // merge that sheds a sizeable share of those lines lost information —
      // fall back to the baseline rather than accept the shorter merge.
      const kept = llm?.revisions.find((r) => r.sectionId === baseline.sectionId);
      const overCut = kept ? isOverCutRevision(baseline.markdown, kept.markdown) : false;
      if (llm && llm.revisions.length > 0 && !overCut) {
        allRevisions.push(...llm.revisions);
        for (const id of llm.removeSectionIds) allRemoves.add(id);
        for (const id of baseline.removeSectionIds) allRemoves.add(id);
      } else {
        allRevisions.push({
          sectionId: baseline.sectionId,
          markdown: baseline.markdown,
        });
        for (const id of baseline.removeSectionIds) allRemoves.add(id);
      }
    }
  }

  // Working copy after whole-section merges.
  const applyWorking = () =>
    input.sections
      .filter((s) => !allRemoves.has(s.sectionId))
      .map((s) => {
        const rev = allRevisions.find((r) => r.sectionId === s.sectionId);
        return rev ? { sectionId: s.sectionId, markdown: rev.markdown } : s;
      });
  const recordChanges = (
    before: Array<{ sectionId: string; markdown: string }>,
    after: Array<{ sectionId: string; markdown: string }>,
    removed: string[] = []
  ) => {
    const prev = new Map(before.map((s) => [s.sectionId, s.markdown]));
    for (const s of after) {
      if (prev.get(s.sectionId) === s.markdown) continue;
      const idx = allRevisions.findIndex((r) => r.sectionId === s.sectionId);
      if (idx >= 0) allRevisions[idx] = { sectionId: s.sectionId, markdown: s.markdown };
      else allRevisions.push({ sectionId: s.sectionId, markdown: s.markdown });
    }
    for (const id of removed) allRemoves.add(id);
  };

  // 1b) Cross-section repeated explanations — deterministic (no model call):
  //     keep the owner's copy, fold unique details into it, trim the rest.
  if (!input.factualOnly) {
    const before = applyWorking();
    const consolidated = consolidateRepeatedExplanations(before);
    if (consolidated.changed) {
      recordChanges(before, consolidated.sections, consolidated.removeSectionIds);
    }

    // 1c) Meaning-level leftovers → one bounded model call on compact excerpts.
    const afterDeterministic = applyWorking();
    const semantic = await trimRepeatedExplanationsWithModel({
      sections: afterDeterministic,
      lectureTitle: input.lectureTitle,
      userId: input.userId,
    });
    if (semantic.changed) recordChanges(afterDeterministic, semantic.sections);
  }

  // 2) Factual review in batches that fit the budget (requires API key).
  //    Skipped for slides-only sessions (no speech, no screen): the notes
  //    were drafted from the deck itself, so the only thing this pass could
  //    do is misread "not in the transcript" as "wrong" and cut content.
  const transcriptText = input.transcript.trim();
  const screenText = (input.screenContent ?? "").trim();
  const hasSpokenOrScreenEvidence =
    transcriptText.length >= MIN_REVIEW_TRANSCRIPT_CHARS || screenText.length > 0;
  if (process.env.ANTHROPIC_API_KEY && hasSpokenOrScreenEvidence) {
    const forFactual = applyWorking();

    for (
      let i = 0;
      i < forFactual.length;
      i += MAX_REVIEW_SECTIONS_PER_BATCH
    ) {
      const batch = forFactual.slice(i, i + MAX_REVIEW_SECTIONS_PER_BATCH);
      // A section longer than the prompt slice can only come back truncated
      // — it is shown for context but is never a revision/removal target.
      const revisable = batch.filter(
        (s) => s.markdown.length <= MAX_REVIEW_SECTION_CHARS
      );
      if (revisable.length === 0) continue;
      const allowed = new Set(revisable.map((s) => s.sectionId));
      const sectionsBlock = batch
        .map((s) =>
          allowed.has(s.sectionId)
            ? `[SECTION ${s.sectionId}]\n${s.markdown}`
            : `[SECTION ${s.sectionId} — context only, do not revise]\n${s.markdown.slice(0, MAX_SECTION_MARKDOWN_CHARS)}…`
        )
        .join("\n\n");
      const deck = selectDeckExcerptFor(
        batch.map((s) => s.markdown).join("\n"),
        (input.deckContent ?? "").trim(),
        MAX_REVIEW_SCREEN_CHARS
      );
      const userPrompt = [
        input.lectureTitle
          ? `LECTURE: ${input.lectureTitle.slice(0, 200)}`
          : null,
        `NOTE SECTIONS TO VERIFY (document order — earliest first):\n\n${sectionsBlock}`,
        screenText
          ? `ON-SCREEN CONTENT (authoritative for spellings/numbers/tables):\n${screenText.slice(0, MAX_REVIEW_SCREEN_CHARS)}`
          : null,
        deck
          ? `DECK SLIDES (excerpt of the pre-uploaded deck most relevant to these sections — other slides exist but are not shown; spellings/formulas/tables):\n${deck}`
          : null,
        `LECTURE TRANSCRIPT (may be partial):\n${transcriptText.slice(0, MAX_REVIEW_TRANSCRIPT_CHARS)}`,
        "\nReturn the JSON now. FACTUAL / SPELLING FIXES only for this batch — do not invent structural merges unless a clear pure duplicate remains.",
      ]
        .filter(Boolean)
        .join("\n\n");

      const llm = await callReviewModel({
        systemExtra:
          "This call is FACTUAL / SPELLING FIXES for the listed batch. Avoid structural merges unless a pure duplicate is obvious.",
        userPrompt,
        allowed,
        maxRevisions: revisable.length,
        userId: input.userId,
      });
      if (!llm) continue;
      const originals = new Map(revisable.map((s) => [s.sectionId, s.markdown]));
      for (const rev of llm.revisions) {
        // Deterministic over-cut guard: a narrow factual fix cannot shed a
        // large share of the section's lines. Reject such revisions whole.
        const original = originals.get(rev.sectionId);
        if (original && isOverCutRevision(original, rev.markdown)) {
          console.warn(
            `[live-lecture-notes] review over-cut rejected for ${rev.sectionId} (${original.length} → ${rev.markdown.length} chars)`
          );
          continue;
        }
        const idx = allRevisions.findIndex((r) => r.sectionId === rev.sectionId);
        if (idx >= 0) allRevisions[idx] = rev;
        else allRevisions.push(rev);
      }
      // Factual review may not delete sections: "not in the sources" is not
      // evidence. Whole-section removal is the consolidation step's job.
    }
  }

  if (allRevisions.length === 0 && allRemoves.size === 0) {
    return { revisions: [], removeSectionIds: [] };
  }

  return {
    revisions: allRevisions,
    removeSectionIds: [...allRemoves],
  };
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
