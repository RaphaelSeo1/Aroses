import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingDbColumnError } from "@/lib/supabase/schema-compat";

/** Remove focus cards generated from a note, including those attached to a course. */
export async function purgeFocusQuestionsForNote(
  supabase: SupabaseClient,
  userId: string,
  noteId: string
): Promise<void> {
  const { error } = await supabase
    .from("user_personal_quiz_items")
    .delete()
    .eq("user_id", userId)
    .eq("source_note_id", noteId);
  if (error && !isMissingDbColumnError(error, "source_note_id")) {
    console.error("[purgeFocusQuestionsForNote]", error);
  }
}
