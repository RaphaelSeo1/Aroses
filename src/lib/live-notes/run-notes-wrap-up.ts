import "server-only";
import {
  reviewLiveLectureNotes,
  summarizeLiveLecture,
} from "@/lib/ai/live-lecture-notes";
import {
  dedupeSectionLines,
} from "@/lib/live-notes/fold-note-markdown";
import { consolidateNoteDocument } from "@/lib/notes/consolidate-notes";
import {
  deckPagesToSourceUnits,
  formatUnrepresentedUnits,
  findUnrepresentedSourceUnits,
  restoreUnrepresentedSourceUnits,
  type CoverageDeckPage,
} from "@/lib/notes/source-coverage";
import { sanitizeNoteOutput } from "@/lib/live-notes/sanitize-note-output";
import {
  appendAiNoteSections,
  applyNoteRevisions,
  collectAiNoteSections,
  setLectureRecapMarkdown,
} from "@/lib/live-notes/notes-review";

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

  try {
    const sections = collectAiNoteSections(notesJson);
    if (sections.length > 0) {
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

      // Final coverage vs ORIGINAL source units (slides/pages). Diagnostic
      // log plus a deterministic restore of unique source lines the notes
      // never captured — no extra model call, no invented facts.
      if (input.deckPages && input.deckPages.length > 0) {
        const finalMd = collectAiNoteSections(notesJson)
          .map((s) => s.markdown)
          .join("\n");
        const restored = restoreUnrepresentedSourceUnits(
          deckPagesToSourceUnits(input.deckPages),
          finalMd
        );
        if (restored.sections.length > 0) {
          notesJson = appendAiNoteSections(notesJson, restored.sections);
          const after = collectAiNoteSections(notesJson)
            .map((s) => s.markdown)
            .join("\n");
          const still = findUnrepresentedSourceUnits(
            deckPagesToSourceUnits(input.deckPages),
            after
          );
          console.warn(
            `[live-notes wrap-up] restored unique lines from ${restored.sections.length} skipped source range(s)` +
              (still.length
                ? `; still unrepresented: ${formatUnrepresentedUnits(still)}`
                : "")
          );
        } else if (restored.missing.length > 0) {
          console.warn(
            `[live-notes wrap-up] ${restored.missing.length}/${input.deckPages.length} substantive source units unrepresented in notes: ${formatUnrepresentedUnits(restored.missing)}`
          );
        }
      }
    }
  } catch (e) {
    console.error("[live-notes wrap-up] review", e);
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
