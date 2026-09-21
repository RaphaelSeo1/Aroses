import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingDbColumnError } from "@/lib/supabase/schema-compat";
import {
  courseIdForNotesFocusBucket,
  isGenericFocusTitle,
  notesFocusBucketId,
  parseNotesFocusBucketNoteId,
} from "@/lib/notes/notes-focus-bucket";

export type NotesHubKind = "custom" | "live" | "tutor" | "standalone";

export type NotesFocusBucketMeta = {
  fileName: string;
  courseId: string | null;
  courseTitle: string | null;
  noteDeleted: boolean;
  /** Custom notes-hub folder (`user_note_sections`), if any. */
  sectionId?: string | null;
  sectionTitle?: string | null;
  /** How this note appears in the notes hub when it is not course-linked. */
  hubKind?: NotesHubKind | null;
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
    section_id?: string | null;
    courses?:
      | { id: string; title: string | null }
      | { id: string; title: string | null }[]
      | null;
  };

  let notes: NoteRow[] | null = null;
  let error: { message?: string } | null = null;
  const first = await supabase
    .from("user_notes")
    .select(
      "id, title, course_id, deleted_at, section_id, courses ( id, title )"
    )
    .eq("user_id", userId)
    .in("id", [...noteIds]);
  notes = (first.data as NoteRow[] | null) ?? null;
  error = first.error;
  if (error && isMissingDbColumnError(error, "section_id")) {
    const fallback = await supabase
      .from("user_notes")
      .select("id, title, course_id, deleted_at, courses ( id, title )")
      .eq("user_id", userId)
      .in("id", [...noteIds]);
    notes = (fallback.data as NoteRow[] | null) ?? null;
    error = fallback.error;
  }
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

  const sectionTitleById = new Map<string, string>();
  const sectionIds = [
    ...new Set(
      (notes ?? [])
        .map((row) =>
          typeof row.section_id === "string" && row.section_id.trim()
            ? row.section_id
            : null
        )
        .filter((id): id is string => Boolean(id))
    ),
  ];
  if (sectionIds.length > 0) {
    const { data: sectionRows, error: sectionErr } = await supabase
      .from("user_note_sections")
      .select("id, title")
      .eq("user_id", userId)
      .in("id", sectionIds);
    if (sectionErr) {
      console.error("[hydrateNotesFocusBucketMeta sections]", sectionErr);
    }
    for (const row of sectionRows ?? []) {
      if (typeof row.id !== "string" || !row.id) continue;
      const title =
        typeof row.title === "string" && row.title.trim()
          ? row.title.trim()
          : "New section";
      sectionTitleById.set(row.id, title);
    }
  }

  const sessionCourseByNoteId = new Map<string, string>();
  const sessionTitleByNoteId = new Map<string, string>();
  const liveNoteIds = new Set<string>();
  if (noteIds.size > 0) {
    const sessionQuery = await supabase
      .from("live_lecture_sessions")
      .select("user_note_id, course_id, title")
      .eq("user_id", userId)
      .in("user_note_id", [...noteIds]);
    if (
      !sessionQuery.error ||
      !isMissingDbColumnError(sessionQuery.error, "user_note_id")
    ) {
      for (const row of sessionQuery.data ?? []) {
        const noteId =
          typeof row.user_note_id === "string" ? row.user_note_id : null;
        if (!noteId) continue;
        liveNoteIds.add(noteId);
        if (typeof row.course_id === "string" && row.course_id) {
          sessionCourseByNoteId.set(noteId, row.course_id);
          if (!courseTitleById.has(row.course_id)) {
            courseIds.add(row.course_id);
          }
        }
        if (typeof row.title === "string" && row.title.trim()) {
          sessionTitleByNoteId.set(noteId, row.title.trim());
        }
      }
    }
    const extraCourseIds = [...courseIds].filter((id) => !courseTitleById.has(id));
    if (extraCourseIds.length > 0) {
      const { data: extraCourses } = await supabase
        .from("courses")
        .select("id, title")
        .in("id", extraCourseIds);
      for (const row of extraCourses ?? []) {
        const title =
          typeof row.title === "string" && row.title.trim()
            ? row.title.trim()
            : null;
        if (typeof row.id === "string" && title) {
          courseTitleById.set(row.id, title);
        }
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
    const sectionId =
      typeof raw.section_id === "string" && raw.section_id.trim()
        ? raw.section_id
        : null;
    const courseId = courseIdForNotesFocusBucket(
      typeof raw.course_id === "string" ? raw.course_id : courseRow?.id,
      sessionCourseByNoteId.get(id),
      sectionId
    );
    const noteTitle =
      typeof raw.title === "string" && raw.title.trim()
        ? raw.title.trim()
        : "";
    const sessionTitle = sessionTitleByNoteId.get(id) ?? "";
    const title =
      (noteTitle && !isGenericFocusTitle(noteTitle) ? noteTitle : "") ||
      sessionTitle ||
      noteTitle ||
      "Notes";
    const sectionTitle = sectionId
      ? (sectionTitleById.get(sectionId) ?? "New section")
      : null;
    let hubKind: NotesHubKind | null = null;
    if (sectionId) hubKind = "custom";
    else if (!courseId) {
      if (liveNoteIds.has(id)) hubKind = "live";
      else hubKind = "standalone";
    }
    out.set(bucketId, {
      fileName: title,
      courseId,
      courseTitle: sectionId
        ? null
        : (courseId ? courseTitleById.get(courseId) : null) ??
          courseRow?.title ??
          null,
      noteDeleted: Boolean((raw as { deleted_at?: unknown }).deleted_at),
      sectionId,
      sectionTitle,
      hubKind,
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
