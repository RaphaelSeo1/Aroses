export const LIVE_LECTURE_INGEST_MAX = 500_000;

/** Reserved so a long note dump cannot drop the transcript, and vice versa. */
const NOTES_BUDGET = 180_000;
const TRANSCRIPT_BUDGET = 180_000;
const SCREEN_BUDGET = 70_000;
const DECK_BUDGET = 70_000;

export type LiveLectureSourceParts = {
  title: string;
  notesMarkdown?: string;
  transcript: string;
  screenContent?: string;
  deckContent?: string;
};

function block(heading: string, body: string, budget: number): string | null {
  const text = body.trim();
  if (!text) return null;
  return `${heading}\n${text}`.slice(0, budget);
}

/**
 * Pack notes + transcript (+ screen/deck) into the ingest blob.
 * Notes and transcript each get a reserved budget so slide-folded notes
 * and the speech capture both reach course generation.
 */
export function packLiveLectureIngestBlob(
  parts: LiveLectureSourceParts
): string {
  const title = parts.title.trim() || "Live lecture";
  const chunks = [
    block(`[from ${title} notes]`, parts.notesMarkdown ?? "", NOTES_BUDGET),
    block(`[from ${title} transcript]`, parts.transcript, TRANSCRIPT_BUDGET),
    block(`[from ${title} screen]`, parts.screenContent ?? "", SCREEN_BUDGET),
    block(`[from ${title} slides]`, parts.deckContent ?? "", DECK_BUDGET),
  ].filter((c): c is string => Boolean(c));
  return chunks.join("\n\n").slice(0, LIVE_LECTURE_INGEST_MAX);
}
