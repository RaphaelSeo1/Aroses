import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingDbColumnError } from "@/lib/supabase/schema-compat";

const EMPTY_DOC = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

type LiveSessionNoteFields = {
  user_note_id?: string | null;
  notes_json?: unknown;
  notes_text?: string | null;
  title?: string | null;
  course_id?: string | null;
};

async function loadLiveSession(
  supabase: SupabaseClient,
  sessionId: string,
  userId: string
): Promise<LiveSessionNoteFields | null> {
  const first = await supabase
    .from("live_lecture_sessions")
    .select("user_note_id, notes_json, notes_text, title, course_id")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!first.error) return (first.data as LiveSessionNoteFields | null) ?? null;
  if (isMissingDbColumnError(first.error, "user_note_id", "course_id")) {
    const fallback = await supabase
      .from("live_lecture_sessions")
      .select("notes_json, notes_text, title")
      .eq("id", sessionId)
      .eq("user_id", userId)
      .maybeSingle();
    return (fallback.data as LiveSessionNoteFields | null) ?? null;
  }
  console.error("[ensureLiveSessionUserNote load]", first.error);
  return null;
}

async function patchNoteCourseId(
  supabase: SupabaseClient,
  userId: string,
  noteId: string,
  courseId: string
): Promise<void> {
  const { error } = await supabase
    .from("user_notes")
    .update({
      course_id: courseId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", noteId)
    .eq("user_id", userId);
  if (error && !isMissingDbColumnError(error, "course_id")) {
    console.error("[ensureLiveSessionUserNote course]", error);
  }
}

/**
 * Make sure a course/standalone live session has a `user_notes` row so
 * notes-origin focus cards can store `source_note_id`. Copies `course_id`
 * onto the note when the session is course-linked and the note is missing it.
 * Does not attach the note to a study material.
 */
export async function ensureLiveSessionUserNote(
  supabase: SupabaseClient,
  sessionId: string,
  userId: string
): Promise<{ noteId: string; courseId: string | null } | null> {
  const session = await loadLiveSession(supabase, sessionId, userId);
  if (!session) return null;

  const courseId =
    typeof session.course_id === "string" && session.course_id
      ? session.course_id
      : null;
  const title =
    typeof session.title === "string" && session.title.trim()
      ? session.title.trim().slice(0, 200)
      : "Live lecture";

  let noteId =
    typeof session.user_note_id === "string" && session.user_note_id
      ? session.user_note_id
      : null;

  if (noteId) {
    if (courseId) await patchNoteCourseId(supabase, userId, noteId, courseId);
    return { noteId, courseId };
  }

  const insert: Record<string, unknown> = {
    user_id: userId,
    title,
    content_json: session.notes_json ?? EMPTY_DOC,
    content_text:
      typeof session.notes_text === "string" ? session.notes_text : "",
    updated_at: new Date().toISOString(),
  };
  if (courseId) insert.course_id = courseId;

  let created = await supabase
    .from("user_notes")
    .insert(insert)
    .select("id")
    .single();
  if (created.error && isMissingDbColumnError(created.error, "course_id")) {
    delete insert.course_id;
    created = await supabase
      .from("user_notes")
      .insert(insert)
      .select("id")
      .single();
  }
  if (created.error || !created.data?.id) {
    console.error("[ensureLiveSessionUserNote insert]", created.error);
    return null;
  }
  noteId = created.data.id as string;

  const { error: linkErr } = await supabase
    .from("live_lecture_sessions")
    .update({
      user_note_id: noteId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId)
    .eq("user_id", userId);
  if (linkErr && !isMissingDbColumnError(linkErr, "user_note_id")) {
    console.error("[ensureLiveSessionUserNote link]", linkErr);
  }

  return { noteId, courseId };
}

/** Copy live session notes into the linked standalone user_notes row. */
export async function syncLiveSessionToStandaloneNote(
  supabase: SupabaseClient,
  sessionId: string,
  userId: string
): Promise<{ noteId: string } | null> {
  const ensured = await ensureLiveSessionUserNote(supabase, sessionId, userId);
  if (!ensured) return null;

  const session = await loadLiveSession(supabase, sessionId, userId);
  if (!session) return { noteId: ensured.noteId };

  const title =
    typeof session.title === "string" && session.title.trim()
      ? session.title.trim().slice(0, 200)
      : undefined;

  const { error } = await supabase
    .from("user_notes")
    .update({
      content_json: session.notes_json ?? EMPTY_DOC,
      content_text:
        typeof session.notes_text === "string" ? session.notes_text : "",
      ...(title ? { title } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", ensured.noteId)
    .eq("user_id", userId);
  if (error) {
    console.error("[syncLiveSessionToStandaloneNote]", error);
  }

  return { noteId: ensured.noteId };
}
