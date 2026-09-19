import "server-only";
import {
  MIN_REVIEW_TRANSCRIPT_CHARS,
  reviewLiveLectureNotes,
  summarizeLiveLecture,
} from "@/lib/ai/live-lecture-notes";
import {
  dedupeSectionLines,
} from "@/lib/live-notes/fold-note-markdown";
import { consolidateNoteDocument } from "@/lib/notes/consolidate-notes";
import {
  deckPagesToSourceUnits,
  type CoverageDeckPage,
} from "@/lib/notes/source-coverage";
import {
  buildSourceCoverageLedger,
  formatSourceCoverageAudit,
  repairSourceCoverage,
} from "@/lib/notes/source-coverage-ledger";
import { sanitizeNoteOutput } from "@/lib/live-notes/sanitize-note-output";
import {
  appendAiNoteSections,
  applyNoteRevisions,
  collectAiNoteSections,
  collectNonAiNoteMarkdown,
  setLectureRecapMarkdown,
} from "@/lib/live-notes/notes-review";

/**
 * Deterministic source-coverage repair over a stored notes doc. Coverage is
 * checked against the whole document (student sections count as present);
 * repairs extend fully-AI sections or append new AI sections. Returns the
 * (possibly) updated doc and logs the before/after audit.
 */
export function repairNotesSourceCoverage(
  notesJson: unknown,
  deckPages: CoverageDeckPage[]
): unknown {
  const ledger = buildSourceCoverageLedger(deckPagesToSourceUnits(deckPages));
  const aiSections = collectAiNoteSections(notesJson);
  const aiIds = new Set(aiSections.map((s) => s.sectionId));
  const result = repairSourceCoverage(ledger, aiSections, {
    extraMarkdown: collectNonAiNoteMarkdown(notesJson),
  });
  const before = formatSourceCoverageAudit(result.before);
  if (result.repairs.length === 0) {
    if (result.before.counts.missing > 0) {
      console.warn(`[live-notes wrap-up] source coverage (unrepairable): ${before}`);
    } else {
      console.info(`[live-notes wrap-up] source coverage: ${before}`);
    }
    return notesJson;
  }
  const revisions = result.sections
    .filter((s) => aiIds.has(s.sectionId))
    .filter((s) => {
      const prev = aiSections.find((a) => a.sectionId === s.sectionId);
      return prev && prev.markdown.replace(/\s+$/, "") !== s.markdown.replace(/\s+$/, "");
    })
    .map((s) => ({ sectionId: s.sectionId, markdown: s.markdown }));
  const added = result.sections.filter((s) => !aiIds.has(s.sectionId));
  let next = notesJson;
  if (revisions.length > 0) next = applyNoteRevisions(next, revisions);
  if (added.length > 0) next = appendAiNoteSections(next, added);
  console.warn(
    `[live-notes wrap-up] source coverage repaired in ${result.passes} pass(es): ${before} → ${formatSourceCoverageAudit(result.after)}; ${revisions.length} section(s) extended, ${added.length} added`
  );
  return next;
}

/**
 * Finish wrap-up: factual review of AI sections, then store a tutor-style
 * lecture recap on the notes doc attrs. Best-effort — failures leave notes
 * as-is for that step.
 */
export async function runLiveNotesWrapUp(input: {
  notesJson: unknown;
  transcript: string;
  screenContent?: string;
  deckContent?: string;
  /** Original source units (slides/pages/chunks) — coverage restore, no model. */
  deckPages?: CoverageDeckPage[];
  lectureTitle?: string;
  durationSeconds?: number | null;
  startedAt?: string | null;
  userId?: string;
}): Promise<unknown> {
  let notesJson = input.notesJson;

  // Slides-only session (no speech, no screen): the draft came from one
  // generator working off its own outline, so the redundancy passes below
  // (duplicate-topic merge, repeated-explanation trim, semantic trim) have
  // nothing legitimate to remove and can only thin a comprehensive first
  // draft. They exist for live continuation over already-drafted notes.
  const seedOnly =
    input.transcript.trim().length < MIN_REVIEW_TRANSCRIPT_CHARS &&
    !(input.screenContent ?? "").trim();

  try {
    const sections = collectAiNoteSections(notesJson);
    if (seedOnly && sections.length > 0) {
      const tidy = sections
        .map((s) => ({
          sectionId: s.sectionId,
          markdown: dedupeSectionLines(sanitizeNoteOutput(s.markdown)),
        }))
        .filter((r, i) => r.markdown.replace(/\s+$/, "") !== sections[i]!.markdown.replace(/\s+$/, ""));
      if (tidy.length > 0) notesJson = applyNoteRevisions(notesJson, tidy);
    } else if (sections.length > 0) {
      const revisions = await reviewLiveLectureNotes({
        sections,
        transcript: input.transcript,
        screenContent: input.screenContent,
        deckContent: input.deckContent,
        lectureTitle: input.lectureTitle,
        userId: input.userId,
      });
      if (
        revisions &&
        (revisions.revisions.length > 0 || revisions.removeSectionIds.length > 0)
      ) {
        const cleanedRevisions = revisions.revisions.map((r) => ({
          sectionId: r.sectionId,
          markdown: dedupeSectionLines(sanitizeNoteOutput(r.markdown)),
        }));
        notesJson = applyNoteRevisions(
          notesJson,
          cleanedRevisions,
          revisions.removeSectionIds
        );
      }

      // Final pass — the same shared deterministic consolidation every note
      // generator uses (sanitize, line dedupe, same-topic merge, repeated
      // explanations, navigation-language strip), so a model revision cannot
      // re-introduce an explanation that already lives in an earlier section.
      const consolidated = consolidateNoteDocument(collectAiNoteSections(notesJson));
      if (consolidated.changed) {
        notesJson = applyNoteRevisions(
          notesJson,
          consolidated.revisions,
          consolidated.removeSectionIds
        );
      }
    }
  } catch (e) {
    console.error("[live-notes wrap-up] review", e);
  }

  // Final source-coverage audit against the ORIGINAL source units, run AFTER
  // every model review, consolidation, and merge: each substantive slide /
  // page must end as COVERED, REDUNDANT, NON-SUBSTANTIVE, or VISUAL-ONLY.
  // MISSING contributions are copied back in the source's own wording into
  // the best-matching AI section (or a new one) — no model call, nothing
  // invented, student-owned sections never edited.
  try {
    if (input.deckPages && input.deckPages.length > 0) {
      notesJson = repairNotesSourceCoverage(notesJson, input.deckPages);
    }
  } catch (e) {
    console.error("[live-notes wrap-up] source coverage", e);
  }

  try {
    const outline = collectAiNoteSections(notesJson)
      .map((s) => s.markdown)
      .join("\n\n");
    const recapMd = await summarizeLiveLecture({
      transcript: input.transcript,
      screenContent: input.screenContent,
      deckContent: input.deckContent,
      lectureTitle: input.lectureTitle,
      notesOutline: outline || undefined,
      durationSeconds: input.durationSeconds,
      startedAt: input.startedAt,
      userId: input.userId,
    });
    if (recapMd) {
      notesJson = setLectureRecapMarkdown(notesJson, recapMd);
    }
  } catch (e) {
    console.error("[live-notes wrap-up] recap", e);
  }

  return notesJson;
}
