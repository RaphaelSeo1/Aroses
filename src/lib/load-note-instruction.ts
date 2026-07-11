import type { SupabaseClient } from "@supabase/supabase-js";

/** True when an error is "the note_instruction column doesn't exist yet"
 *  (migration 089 not applied). Mirrors src/lib/profile-db-errors.ts. */
export function isNoteInstructionColumnError(
  message: string | undefined
): boolean {
  const m = message ?? "";
  return (
    /\bnote_instruction\b/i.test(m) &&
    /does not exist|could not find|schema cache/i.test(m)
  );
}

/**
 * Read the per-session `note_instruction` from one of its home tables.
 * Graceful by construction: a missing column (migration not applied), a
 * missing row, or any query error all resolve to "" — never crash a session.
 */
export async function loadNoteInstruction(
  supabase: SupabaseClient,
  table: "live_lecture_sessions" | "tutor_sessions" | "user_course_onboarding",
  match: Record<string, string>
): Promise<string> {
  try {
    const { data, error } = await supabase
      .from(table)
      .select("note_instruction")
      .match(match)
      .maybeSingle();
    if (error || !data) return "";
    const value = (data as { note_instruction?: unknown }).note_instruction;
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}
