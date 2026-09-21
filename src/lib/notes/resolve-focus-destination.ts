import type { SupabaseClient } from "@supabase/supabase-js";
import { canAccessStudyMaterial } from "@/lib/supabase/study-material-access";
import { isMissingDbColumnError } from "@/lib/supabase/schema-compat";
import { isUuid } from "@/lib/voice-tutor/uuid";
import { ensureLiveSessionUserNote } from "@/lib/live-notes/sync-standalone-note";

export type FocusSourceInput = {
  materialId?: string;
  moduleId?: number;
  noteId?: string;
  liveSessionId?: string;
  tutorSessionId?: string;
};

export type FocusDestination = {
  materialId: string | null;
  moduleId: number | null;
  sourceNoteId: string | null;
  sourceLabel: string;
};

function firstModuleId(payload: unknown, preferred?: number): number {
  const mods =
    payload && typeof payload === "object"
      ? (payload as { modules?: Array<{ id?: number }> }).modules
      : undefined;
  const ids = Array.isArray(mods)
    ? mods.map((m) => m.id).filter((id): id is number => typeof id === "number")
    : [];
  if (preferred != null && ids.includes(preferred)) return preferred;
  return ids[0] ?? 1;
}

/**
 * Resolve where a notes-sourced focus card should live.
 *
 * Notes / live notes / tutor notes are always notes-origin: persist
 * `source_note_id` + the note title, and never attach onto an existing
 * course PDF just because the note sits next to a course or shares a
 * lecture title. Review grouping uses `user_notes.section_id` (hub folder)
 * first, then `user_notes.course_id` for live-lecture notes without a folder.
 *
 * `materialId` without a note/live/tutor source is course-origin (in-lesson
 * notes on a study material).
 */
export async function resolveFocusDestination(
  supabase: SupabaseClient,
  userId: string,
  input: FocusSourceInput
): Promise<FocusDestination | { error: string; status: number }> {
  const fromNotesSurface = Boolean(
    (input.noteId && isUuid(input.noteId)) ||
      (input.liveSessionId && isUuid(input.liveSessionId)) ||
      (input.tutorSessionId && isUuid(input.tutorSessionId))
  );

  let sourceNoteId: string | null =
    input.noteId && isUuid(input.noteId) ? input.noteId : null;
  let sourceLabel = "Notes";
  let courseId: string | null = null;

  if (input.liveSessionId && isUuid(input.liveSessionId)) {
    const ensured = await ensureLiveSessionUserNote(
      supabase,
      input.liveSessionId,
      userId
    );
    if (ensured?.noteId) sourceNoteId = ensured.noteId;
    if (ensured?.courseId) courseId = ensured.courseId;

    let { data: session, error: sessionErr } = await supabase
      .from("live_lecture_sessions")
      .select("id, user_id, course_id, user_note_id, title")
      .eq("id", input.liveSessionId)
      .eq("user_id", userId)
      .maybeSingle();
    if (sessionErr && isMissingDbColumnError(sessionErr, "user_note_id")) {
      ({ data: session, error: sessionErr } = await supabase
        .from("live_lecture_sessions")
        .select("id, user_id, course_id, title")
        .eq("id", input.liveSessionId)
        .eq("user_id", userId)
        .maybeSingle());
    }
    if (!session) {
      if (sessionErr) console.error("[resolveFocusDestination live]", sessionErr);
      return { error: "Not found.", status: 404 };
    }
    if (
      !sourceNoteId &&
      typeof (session as { user_note_id?: unknown }).user_note_id === "string"
    ) {
      sourceNoteId = (session as { user_note_id: string }).user_note_id;
    }
    if (typeof session.title === "string" && session.title.trim()) {
      sourceLabel = session.title.trim();
    }
    if (!courseId && typeof session.course_id === "string") {
      courseId = session.course_id;
    }
  }

  if (input.tutorSessionId && isUuid(input.tutorSessionId)) {
    const { data: session } = await supabase
      .from("tutor_sessions")
      .select("id, title")
      .eq("id", input.tutorSessionId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!session) return { error: "Not found.", status: 404 };
    if (typeof session.title === "string" && session.title.trim()) {
      sourceLabel = session.title.trim();
    }
  }

  if (sourceNoteId) {
    let { data: note, error: noteErr } = await supabase
      .from("user_notes")
      .select("id, title, course_id")
      .eq("id", sourceNoteId)
      .eq("user_id", userId)
      .maybeSingle();
    if (noteErr && isMissingDbColumnError(noteErr, "course_id")) {
      ({ data: note, error: noteErr } = await supabase
        .from("user_notes")
        .select("id, title")
        .eq("id", sourceNoteId)
        .eq("user_id", userId)
        .maybeSingle());
    }
    if (!note) {
      const hasOtherSource = Boolean(
        input.materialId || input.liveSessionId || input.tutorSessionId
      );
      if (!hasOtherSource) return { error: "Not found.", status: 404 };
      if (noteErr) console.error("[resolveFocusDestination note]", noteErr);
      sourceNoteId = null;
    } else {
      if (typeof note.title === "string" && note.title.trim()) {
        sourceLabel = note.title.trim();
      }
      if (
        !courseId &&
        typeof (note as { course_id?: unknown }).course_id === "string"
      ) {
        courseId = (note as { course_id: string }).course_id;
      }
    }
  } else if (input.noteId && isUuid(input.noteId)) {
    return { error: "Not found.", status: 404 };
  }

  if (courseId && sourceNoteId) {
    const { error } = await supabase
      .from("user_notes")
      .update({
        course_id: courseId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", sourceNoteId)
      .eq("user_id", userId);
    if (error && !isMissingDbColumnError(error, "course_id")) {
      console.error("[resolveFocusDestination note course]", error);
    }
  }

  // Notes-origin cards stay notes-only. Course parent in Review is hydrated
  // from the note's course_id — never from some other course's PDF.
  if (fromNotesSurface) {
    return {
      materialId: null,
      moduleId: null,
      sourceNoteId,
      sourceLabel,
    };
  }

  if (input.materialId && isUuid(input.materialId)) {
    const ok = await canAccessStudyMaterial(supabase, userId, input.materialId);
    if (!ok) return { error: "Not found.", status: 404 };
    const { data: mat } = await supabase
      .from("study_materials")
      .select("id, file_name, course_payload")
      .eq("id", input.materialId)
      .maybeSingle();
    if (!mat) return { error: "Not found.", status: 404 };
    const materialLabel =
      ((mat.file_name as string) || "").replace(/\.[a-z0-9]{2,5}$/i, "").trim() ||
      "Course notes";
    return {
      materialId: mat.id as string,
      moduleId: firstModuleId(mat.course_payload, input.moduleId),
      sourceNoteId,
      sourceLabel: sourceLabel !== "Notes" ? sourceLabel : materialLabel,
    };
  }

  return {
    materialId: null,
    moduleId: null,
    sourceNoteId,
    sourceLabel,
  };
}
