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

  const courseTitleById = new Map<string, string>();
  const courseIds = new Set<string>();
  for (const raw of notes ?? []) {
    if (typeof raw.course_id === "string" && raw.course_id) {
      courseIds.add(raw.course_id);
    }
    const courses = raw.courses as
      | { id: string; title: string | null }
      | { id: string; title: string | null }[]
      | null;
    const courseRow = Array.isArray(courses) ? courses[0] : courses;
    if (courseRow?.id && courseRow.title) {
      courseTitleById.set(courseRow.id, courseRow.title);
    }
  }
  const missingCourseIds = [...courseIds].filter((id) => !courseTitleById.has(id));
  if (missingCourseIds.length > 0) {
    const { data: courseRows, error: courseErr } = await supabase
      .from("courses")
      .select("id, title")
      .in("id", missingCourseIds);
    if (courseErr) {
      console.error("[hydrateNotesFocusBucketMeta courses]", courseErr);
    }
    for (const row of courseRows ?? []) {
      const title =
        typeof row.title === "string" && row.title.trim() ? row.title.trim() : null;
      if (typeof row.id === "string" && title) {
        courseTitleById.set(row.id, title);
      }
    }
  }

  for (const raw of notes ?? []) {
    const id = raw.id;
    const bucketId = notesFocusBucketId(id);
    const courses = raw.courses as
      | { id: string; title: string | null }
      | { id: string; title: string | null }[]
      | null;
    const courseRow = Array.isArray(courses) ? courses[0] : courses;
    const courseId =
      typeof raw.course_id === "string"
        ? raw.course_id
        : (courseRow?.id ?? null);
    out.set(bucketId, {
      fileName:
        (typeof raw.title === "string" && raw.title.trim()) || "Notes",
      courseId,
      courseTitle:
        (courseId ? courseTitleById.get(courseId) : null) ??
        courseRow?.title ??
        null,
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
