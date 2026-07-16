import "server-only";
import {
  reviewLiveLectureNotes,
  summarizeLiveLecture,
} from "@/lib/ai/live-lecture-notes";
import {
  applyNoteRevisions,
  collectAiNoteSections,
  prependLectureSummary,
} from "@/lib/live-notes/notes-review";

/**
 * Finish wrap-up: factual review of AI sections, then prepend a grounded
 * "## Lecture summary" block at the top of the notes doc. Best-effort —
 * failures leave notes as-is for that step.
 */
export async function runLiveNotesWrapUp(input: {
  notesJson: unknown;
  transcript: string;
  screenContent?: string;
  lectureTitle?: string;
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
        lectureTitle: input.lectureTitle,
        userId: input.userId,
      });
      if (
        revisions &&
        (revisions.revisions.length > 0 || revisions.removeSectionIds.length > 0)
      ) {
        notesJson = applyNoteRevisions(
          notesJson,
          revisions.revisions,
          revisions.removeSectionIds
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
    const summaryMd = await summarizeLiveLecture({
      transcript: input.transcript,
      screenContent: input.screenContent,
      lectureTitle: input.lectureTitle,
      notesOutline: outline || undefined,
      userId: input.userId,
    });
    if (summaryMd) {
      notesJson = prependLectureSummary(notesJson, summaryMd);
    }
  } catch (e) {
    console.error("[live-notes wrap-up] summary", e);
  }

  return notesJson;
}
