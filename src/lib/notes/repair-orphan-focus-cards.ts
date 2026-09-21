import type { SupabaseClient } from "@supabase/supabase-js";

export {
  pickNoteForFocusLabel,
  pickLiveSessionForFocusCard,
  pickSectionNoteForStoredLabel,
  resolveFocusCardNoteId,
  focusCardText,
  type FocusNoteMatch,
  type FocusSessionMatch,
  type LiveSessionMatchCandidate,
  type NoteMatchCandidate,
} from "./match-focus-note.ts";

/**
 * Previously ran on every Review GET and rewrote `user_personal_quiz_items`
 * (source_note_id, material_id) plus `user_notes.course_id` by lecture title.
 * That collapsed notes-hub Lecture 2/3 decks into course Lecture 3 and
 * renamed children to the course lecture title.
 *
 * Grouping is read-time now. This function must never UPDATE/DELETE quiz
 * rows or note titles — even if a caller reintroduces it on fetch.
 */
export async function repairOrphanNotesFocusCards(
  _supabase: SupabaseClient,
  _userId: string
): Promise<void> {
  void _supabase;
  void _userId;
}
