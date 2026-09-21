/** Synthetic Review-deck id for legacy focus cards with no note id. */
export const NOTES_FOCUS_BUCKET_ID = "notes";

/** Per-note bucket prefix — keeps similarly titled notes from merging in Review. */
export const NOTES_FOCUS_BUCKET_PREFIX = "note:";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function notesFocusBucketId(
  sourceNoteId: string | null | undefined
): string {
  const id = (sourceNoteId ?? "").trim();
  if (id && UUID_RE.test(id)) {
    return `${NOTES_FOCUS_BUCKET_PREFIX}${id.toLowerCase()}`;
  }
  return NOTES_FOCUS_BUCKET_ID;
}

export function isNotesFocusBucketId(id: string | null | undefined): boolean {
  const n = (id ?? "").trim().toLowerCase();
  return n === NOTES_FOCUS_BUCKET_ID || n.startsWith(NOTES_FOCUS_BUCKET_PREFIX);
}

export function parseNotesFocusBucketNoteId(
  id: string | null | undefined
): string | null {
  const raw = (id ?? "").trim();
  const lower = raw.toLowerCase();
  if (!lower.startsWith(NOTES_FOCUS_BUCKET_PREFIX)) return null;
  const noteId = raw.slice(NOTES_FOCUS_BUCKET_PREFIX.length);
  return UUID_RE.test(noteId) ? noteId : null;
}

/** Placeholder titles that should never win over a real note/course name. */
export function isGenericFocusTitle(label: string | null | undefined): boolean {
  const s = (label ?? "").trim().toLowerCase();
  return (
    !s ||
    s === "notes" ||
    s === "focus questions" ||
    s === "focus cards" ||
    s === "from notes"
  );
}

function validUuid(id: string | null | undefined): string | null {
  const s = (id ?? "").trim();
  return s && UUID_RE.test(s) ? s : null;
}

/**
 * Notes-origin focus cards belong to a `user_notes` / live-notes row.
 * Course-origin cards sit on a study material and must not be titled into
 * another course's note just because the PDF is also named "Lecture 2".
 */
export function isNotesOriginFocusCard(row: {
  materialId?: string | null;
  sourceNoteId?: string | null;
}): boolean {
  if (validUuid(row.sourceNoteId)) return true;
  const mid = (row.materialId ?? "").trim().toLowerCase();
  return !mid || isNotesFocusBucketId(mid);
}

/**
 * Course for a notes-focus Review row.
 *
 * A notes-hub folder (`user_note_sections`) is its own origin — never fold
 * those cards under a course just because a lecture/PDF shares the title
 * or a stale `course_id` was stamped. Live-session course wins over a stale
 * `user_notes.course_id` only when the note is not in a hub folder.
 */
export function courseIdForNotesFocusBucket(
  noteCourseId: string | null | undefined,
  liveSessionCourseId: string | null | undefined,
  sectionId?: string | null
): string | null {
  if (validUuid(sectionId)) return null;
  return validUuid(liveSessionCourseId) ?? validUuid(noteCourseId);
}
