import "server-only";
import {
  reviewLiveLectureNotes,
  summarizeLiveLecture,
} from "@/lib/ai/live-lecture-notes";
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
