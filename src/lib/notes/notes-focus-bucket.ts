/** Synthetic Review-deck id for focus cards generated from notes with no course. */
export const NOTES_FOCUS_BUCKET_ID = "notes";

export function isNotesFocusBucketId(id: string | null | undefined): boolean {
  return (id ?? "").trim().toLowerCase() === NOTES_FOCUS_BUCKET_ID;
}
