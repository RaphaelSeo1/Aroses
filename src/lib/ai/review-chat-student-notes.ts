/**
 * Build the STUDENT NOTES block for Review chat.
 * Prefer the full source-note body; fall back to the card's generation excerpt.
 */

const NOTES_DOC_PATH_RE = /^\/notes\/doc\/[0-9a-f-]{36}$/i;

export type ReviewChatStudentNotesInput = {
  noteTitle?: string | null;
  /** Full plain text from user_notes.content_text (or live session notes). */
  noteBody?: string | null;
  /** Short excerpt stored on the focus card when it was generated. */
  sourceExcerpt?: string | null;
  sourceNoteId?: string | null;
  maxLen?: number;
};

export type ReviewChatStudentNotesResult = {
  /** Block to place near the active card, or null when nothing to include. */
  contextBlock: string | null;
  hadStudentNotes: boolean;
  notesLink: string | null;
  /** Whether we expected a note but found no body/excerpt. */
  notesMissingForCard: boolean;
};

function trimText(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

export function notesDocPathForId(
  sourceNoteId: string | null | undefined
): string | null {
  const id = trimText(sourceNoteId);
  if (!id) return null;
  const path = `/notes/doc/${id}`;
  return NOTES_DOC_PATH_RE.test(path) ? path : null;
}

/**
 * Prefer full note body; if only a generation excerpt exists, use that.
 * When a sourceNoteId is known but both are empty, emit an explicit
 * "not found" block so the model does not invent "I can't see your notes."
 */
export function buildReviewChatStudentNotes(
  input: ReviewChatStudentNotesInput
): ReviewChatStudentNotesResult {
  const maxLen = Math.max(1_000, input.maxLen ?? 16_000);
  const body = trimText(input.noteBody).slice(0, maxLen);
  const excerpt = trimText(input.sourceExcerpt).slice(0, maxLen);
  const title = trimText(input.noteTitle);
  const notesLink = notesDocPathForId(input.sourceNoteId);
  const expectedNote = Boolean(notesLink);

  const primary = body || excerpt;
  if (primary) {
    const parts = [
      "STUDENT NOTES (you can see these — quote verbatim when they cover the question; never claim you cannot see them or ask the student to paste):",
    ];
    if (title) parts.push(`Note title: ${title}`);
    if (body && excerpt && body !== excerpt && !body.includes(excerpt)) {
      parts.push(
        `Card source excerpt (the passage this card was generated from):\n${excerpt}`
      );
      parts.push(`Full note body:\n${body}`);
    } else {
      parts.push(primary);
    }
    return {
      contextBlock: parts.join("\n"),
      hadStudentNotes: true,
      notesLink,
      notesMissingForCard: false,
    };
  }

  if (expectedNote) {
    return {
      contextBlock:
        "STUDENT NOTES: none found for this card's source note. Help from the card content. Do not claim you cannot see the student's notes in general — say notes weren't found for this card.",
      hadStudentNotes: false,
      notesLink: null,
      notesMissingForCard: true,
    };
  }

  return {
    contextBlock: null,
    hadStudentNotes: false,
    notesLink: null,
    notesMissingForCard: false,
  };
}
