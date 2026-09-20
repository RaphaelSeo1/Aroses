import "server-only";
import { synthesizeCanonicalLiveNotes } from "@/lib/ai/canonical-live-notes";
import {
  reviewLiveLectureNotes,
  summarizeLiveLecture,
} from "@/lib/ai/live-lecture-notes";
import {
  applyNoteRevisions,
  collectAiNoteSections,
  collectNoteDraftSections,
  replaceAiNoteDraft,
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
  materials?: Array<{ name: string; text: string }>;
  sourcesComplete?: boolean;
  sourceIncompleteReasons?: string[];
  lectureTitle?: string;
  noteInstruction?: string;
  durationSeconds?: number | null;
  startedAt?: string | null;
  userId?: string;
}): Promise<unknown> {
  let notesJson = input.notesJson;
  let canonicalized = false;

  if (input.sourcesComplete !== false) {
    try {
      const markdown = await synthesizeCanonicalLiveNotes({
        title: input.lectureTitle,
        sources: {
          transcript: input.transcript,
          screen: input.screenContent,
          deck: input.deckContent,
          materials: input.materials,
          complete: input.sourcesComplete,
          incompleteReasons: input.sourceIncompleteReasons,
        },
        existingSections: collectNoteDraftSections(notesJson),
        noteInstruction: input.noteInstruction,
        userId: input.userId,
      });
      if (markdown) {
        notesJson = replaceAiNoteDraft(notesJson, markdown);
        canonicalized = true;
      }
    } catch (e) {
      console.error("[live-notes wrap-up] canonical synthesis", e);
    }
  }

  // Keep the narrow legacy review as a best-effort fallback when canonical
  // synthesis is unavailable. Never run it after the source-grounded rebuild.
  if (!canonicalized && input.sourcesComplete !== false) {
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
          (revisions.revisions.length > 0 ||
            revisions.removeSectionIds.length > 0)
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
