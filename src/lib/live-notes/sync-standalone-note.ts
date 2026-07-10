import type { SupabaseClient } from "@supabase/supabase-js";

const EMPTY_DOC = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

/** Copy live session notes into the linked standalone user_notes row. */
export async function syncLiveSessionToStandaloneNote(
  supabase: SupabaseClient,
  sessionId: string,
  userId: string
): Promise<{ noteId: string } | null> {
  const { data: session } = await supabase
    .from("live_lecture_sessions")
    .select("user_note_id, notes_json, notes_text, title")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .maybeSingle();

  const noteId =
    typeof session?.user_note_id === "string" ? session.user_note_id : null;
  if (!noteId || !session) return null;

  const title =
    typeof session.title === "string" && session.title.trim()
      ? session.title.trim().slice(0, 200)
      : undefined;

  await supabase
    .from("user_notes")
    .update({
      content_json: session.notes_json ?? EMPTY_DOC,
      content_text:
        typeof session.notes_text === "string" ? session.notes_text : "",
      ...(title ? { title } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", noteId)
    .eq("user_id", userId);

  return { noteId };
}
