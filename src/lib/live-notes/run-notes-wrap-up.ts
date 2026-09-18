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
  findUnrepresentedDeckPages,
  formatUnrepresentedPages,
  type CoverageDeckPage,
} from "@/lib/notes/source-coverage";
import { sanitizeNoteOutput } from "@/lib/live-notes/sanitize-note-output";
import {
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
  /** Raw deck pages — diagnostic coverage report only (no model call). */
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

      // Diagnostic only: substantive deck pages with no footprint in the
      // final notes. Never alters the notes; surfaces silent thinning.
      if (input.deckPages && input.deckPages.length > 0) {
        const finalMd = collectAiNoteSections(notesJson)
          .map((s) => s.markdown)
          .join("\n");
        const missing = findUnrepresentedDeckPages(input.deckPages, finalMd);
        if (missing.length > 0) {
          console.warn(
            `[live-notes wrap-up] ${missing.length}/${input.deckPages.length} substantive deck pages unrepresented in notes: ${formatUnrepresentedPages(missing)}`
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
