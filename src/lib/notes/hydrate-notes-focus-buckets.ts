import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingDbColumnError } from "@/lib/supabase/schema-compat";
import {
  notesFocusBucketId,
  parseNotesFocusBucketNoteId,
} from "@/lib/notes/notes-focus-bucket";

export type NotesFocusBucketMeta = {
  fileName: string;
  courseId: string | null;
  courseTitle: string | null;
  noteDeleted: boolean;
};

/** Load note + course titles for per-note Review buckets. */
export async function hydrateNotesFocusBucketMeta(
  supabase: SupabaseClient,
  userId: string,
  bucketIds: Iterable<string>
): Promise<Map<string, NotesFocusBucketMeta>> {
  const noteIds = new Set<string>();
  for (const id of bucketIds) {
    const noteId = parseNotesFocusBucketNoteId(id);
    if (noteId) noteIds.add(noteId);
  }
  const out = new Map<string, NotesFocusBucketMeta>();
  if (noteIds.size === 0) return out;

  type NoteRow = {
    id: string;
    title?: string | null;
    course_id?: string | null;
    deleted_at?: string | null;
    courses?:
      | { id: string; title: string | null }
      | { id: string; title: string | null }[]
      | null;
  };

  let notes: NoteRow[] | null = null;
  let error: { message?: string } | null = null;
  const first = await supabase
    .from("user_notes")
    .select("id, title, course_id, deleted_at, courses ( id, title )")
    .eq("user_id", userId)
    .in("id", [...noteIds]);
  notes = (first.data as NoteRow[] | null) ?? null;
  error = first.error;
  if (error && isMissingDbColumnError(error, "deleted_at", "course_id")) {
    const fallback = await supabase
      .from("user_notes")
      .select("id, title, courses ( id, title )")
      .eq("user_id", userId)
      .in("id", [...noteIds]);
    notes = (fallback.data as NoteRow[] | null) ?? null;
    error = fallback.error;
  }
  if (error) {
    console.error("[hydrateNotesFocusBucketMeta]", error);
    return out;
  }

  for (const raw of notes ?? []) {
    const id = raw.id;
    const bucketId = notesFocusBucketId(id);
    const courses = raw.courses as
      | { id: string; title: string | null }
      | { id: string; title: string | null }[]
      | null;
    const courseRow = Array.isArray(courses) ? courses[0] : courses;
    out.set(bucketId, {
      fileName:
        (typeof raw.title === "string" && raw.title.trim()) || "Notes",
      courseId:
        typeof raw.course_id === "string"
          ? raw.course_id
          : (courseRow?.id ?? null),
      courseTitle: courseRow?.title ?? null,
      noteDeleted: Boolean((raw as { deleted_at?: unknown }).deleted_at),
    });
  }

  // Hard-deleted / inaccessible notes still leave focus rows — treat as gone.
  for (const noteId of noteIds) {
    const bucketId = notesFocusBucketId(noteId);
    if (!out.has(bucketId)) {
      out.set(bucketId, {
        fileName: "Notes",
        courseId: null,
        courseTitle: null,
        noteDeleted: true,
      });
    }
  }
  return out;
}
