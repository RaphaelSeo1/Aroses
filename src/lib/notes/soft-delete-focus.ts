import type { SupabaseClient } from "@supabase/supabase-js";
import {
  NOTES_FOCUS_BUCKET_ID,
  notesFocusBucketId,
  parseNotesFocusBucketNoteId,
} from "@/lib/notes/notes-focus-bucket";
import { isMissingDbColumnError } from "@/lib/supabase/schema-compat";

/**
 * Soft-delete focus cards for a note (or the legacy notes-only bucket).
 * Falls back to hard delete if migration 113 is missing.
 */
export async function softDeleteFocusQuestionsForNote(
  supabase: SupabaseClient,
  userId: string,
  noteId: string | null
): Promise<"soft" | "hard" | "fail"> {
  const now = new Date().toISOString();
  let q = supabase
    .from("user_personal_quiz_items")
    .update({ deleted_at: now })
    .eq("user_id", userId)
    .is("deleted_at", null);
  if (noteId) {
    q = q.eq("source_note_id", noteId);
  } else {
    q = q.is("material_id", null).is("source_note_id", null);
  }
  const { error } = await q;

  if (!error) {
    return "soft";
  }

  if (isMissingDbColumnError(error, "deleted_at")) {
    return (await hardDeleteFocusQuestions(supabase, userId, noteId))
      ? "hard"
      : "fail";
  }

  console.error("[softDeleteFocusQuestionsForNote]", error);
  return "fail";
}

export async function restoreFocusQuestionsForNote(
  supabase: SupabaseClient,
  userId: string,
  noteId: string | null
): Promise<boolean> {
  let q = supabase
    .from("user_personal_quiz_items")
    .update({ deleted_at: null })
    .eq("user_id", userId)
    .not("deleted_at", "is", null);
  if (noteId) {
    q = q.eq("source_note_id", noteId);
  } else {
    q = q.is("material_id", null).is("source_note_id", null);
  }
  const { error } = await q;
  if (!error) return true;
  if (isMissingDbColumnError(error, "deleted_at")) return false;
  console.error("[restoreFocusQuestionsForNote]", error);
  return false;
}

/** Permanently remove soft-deleted focus cards for a note / legacy bucket. */
export async function purgeDeletedFocusQuestionsForNote(
  supabase: SupabaseClient,
  userId: string,
  noteId: string | null
): Promise<boolean> {
  let q = supabase
    .from("user_personal_quiz_items")
    .delete()
    .eq("user_id", userId)
    .not("deleted_at", "is", null);
  if (noteId) {
    q = q.eq("source_note_id", noteId);
  } else {
    q = q.is("material_id", null).is("source_note_id", null);
  }
  const { error } = await q;
  if (!error) return true;
  if (isMissingDbColumnError(error, "deleted_at")) {
    return hardDeleteFocusQuestions(supabase, userId, noteId);
  }
  console.error("[purgeDeletedFocusQuestionsForNote]", error);
  return false;
}

async function hardDeleteFocusQuestions(
  supabase: SupabaseClient,
  userId: string,
  noteId: string | null
): Promise<boolean> {
  let q = supabase
    .from("user_personal_quiz_items")
    .delete()
    .eq("user_id", userId);
  if (noteId) {
    q = q.eq("source_note_id", noteId);
  } else {
    q = q.is("material_id", null);
  }
  const { error } = await q;
  if (error && !isMissingDbColumnError(error, "source_note_id")) {
    console.error("[hardDeleteFocusQuestions]", error);
    return false;
  }
  return true;
}

export type DeletedFocusDeck = {
  materialId: string;
  fileName: string;
  courseId: string | null;
  courseTitle: string | null;
  deletedAt: string;
};

/** Soft-deleted notes-focus decks for the Review Deleted section. */
export async function listDeletedFocusDecks(
  supabase: SupabaseClient,
  userId: string
): Promise<DeletedFocusDeck[]> {
  const { data, error } = await supabase
    .from("user_personal_quiz_items")
    .select("source_note_id, source_label, deleted_at")
    .eq("user_id", userId)
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false });

  if (error) {
    if (isMissingDbColumnError(error, "deleted_at")) return [];
    console.error("[listDeletedFocusDecks]", error);
    return [];
  }

  type Row = {
    source_note_id?: string | null;
    source_label?: string | null;
    deleted_at?: string | null;
  };

  const byBucket = new Map<
    string,
    { noteId: string | null; label: string | null; deletedAt: string }
  >();

  for (const raw of (data ?? []) as Row[]) {
    const deletedAt =
      typeof raw.deleted_at === "string" ? raw.deleted_at : null;
    if (!deletedAt) continue;
    const noteId =
      typeof raw.source_note_id === "string" ? raw.source_note_id : null;
    const bucket = notesFocusBucketId(noteId);
    const existing = byBucket.get(bucket);
    if (!existing || deletedAt > existing.deletedAt) {
      byBucket.set(bucket, {
        noteId,
        label:
          typeof raw.source_label === "string" && raw.source_label.trim()
            ? raw.source_label.trim()
            : existing?.label ?? null,
        deletedAt,
      });
    } else if (
      !existing.label &&
      typeof raw.source_label === "string" &&
      raw.source_label.trim()
    ) {
      existing.label = raw.source_label.trim();
    }
  }

  if (byBucket.size === 0) return [];

  const noteIds = [...byBucket.values()]
    .map((b) => b.noteId)
    .filter((id): id is string => Boolean(id));

  const titleByNote = new Map<string, string>();
  const courseByNote = new Map<
    string,
    { courseId: string | null; courseTitle: string | null }
  >();

  if (noteIds.length > 0) {
    const { data: notes } = await supabase
      .from("user_notes")
      .select("id, title, course_id, courses ( id, title )")
      .eq("user_id", userId)
      .in("id", noteIds);

    for (const n of notes ?? []) {
      const id = String((n as { id: string }).id).toLowerCase();
      const title =
        typeof (n as { title?: string }).title === "string"
          ? (n as { title: string }).title.trim()
          : "";
      if (title) titleByNote.set(id, title);
      const courseId =
        typeof (n as { course_id?: string | null }).course_id === "string"
          ? (n as { course_id: string }).course_id
          : null;
      const courses = (n as {
        courses?:
          | { id: string; title: string | null }
          | { id: string; title: string | null }[]
          | null;
      }).courses;
      let courseTitle: string | null = null;
      if (Array.isArray(courses)) courseTitle = courses[0]?.title ?? null;
      else if (courses) courseTitle = courses.title ?? null;
      courseByNote.set(id, { courseId, courseTitle });
    }
  }

  return [...byBucket.entries()].map(([bucket, meta]) => {
    const noteKey = meta.noteId?.toLowerCase() ?? "";
    const fileName =
      (noteKey && titleByNote.get(noteKey)) ||
      meta.label ||
      (bucket === NOTES_FOCUS_BUCKET_ID ? "Focus questions" : "Focus questions");
    const course = noteKey ? courseByNote.get(noteKey) : undefined;
    return {
      materialId: bucket,
      fileName,
      courseId: course?.courseId ?? null,
      courseTitle: course?.courseTitle ?? null,
      deletedAt: meta.deletedAt,
    };
  });
}

export function parseDeletedFocusBucketId(
  materialId: string
): string | null | undefined {
  const noteId = parseNotesFocusBucketNoteId(materialId);
  if (noteId) return noteId;
  const n = materialId.trim().toLowerCase();
  if (n === NOTES_FOCUS_BUCKET_ID) return null;
  return undefined;
}

/** Run a personal-quiz query with active-only filter; retry if column missing. */
export async function queryActivePersonalQuizItems<T>(
  withFilter: () => PromiseLike<{
    data: T | null;
    error: { message?: string; code?: string } | null;
  }>,
  withoutFilter: () => PromiseLike<{
    data: T | null;
    error: { message?: string; code?: string } | null;
  }>
): Promise<{ data: T | null; error: { message?: string; code?: string } | null }> {
  const first = await withFilter();
  if (first.error && isMissingDbColumnError(first.error, "deleted_at")) {
    return withoutFilter();
  }
  return first;
}
