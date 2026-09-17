import "server-only";
import {
  reviewLiveLectureNotes,
  summarizeLiveLecture,
} from "@/lib/ai/live-lecture-notes";
import {
  dedupeSectionLines,
} from "@/lib/live-notes/fold-note-markdown";
import { consolidateRepeatedExplanations } from "@/lib/notes/cross-section-dedupe";
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

      // Final pass over every remaining AI section: sanitizer + line-level
      // dedupe, then one more deterministic cross-section consolidation so a
      // model revision cannot re-introduce an explanation that already lives
      // in an earlier section.
      const after = collectAiNoteSections(notesJson);
      const polished = after.map((s) => ({
        sectionId: s.sectionId,
        markdown: dedupeSectionLines(sanitizeNoteOutput(s.markdown)),
      }));
      const consolidated = consolidateRepeatedExplanations(polished);
      const before = new Map(after.map((s) => [s.sectionId, s.markdown]));
      const polish = consolidated.sections.filter(
        (s) => before.get(s.sectionId) !== s.markdown
      );
      if (polish.length > 0 || consolidated.removeSectionIds.length > 0) {
        notesJson = applyNoteRevisions(
          notesJson,
          polish,
          consolidated.removeSectionIds
        );
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
