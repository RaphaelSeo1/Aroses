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
