import type { SupabaseClient } from "@supabase/supabase-js";
import { canAccessStudyMaterial } from "@/lib/supabase/study-material-access";
import { isUuid } from "@/lib/voice-tutor/uuid";

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

async function materialForCourse(
  supabase: SupabaseClient,
  userId: string,
  courseId: string
): Promise<{ id: string; file_name: string | null; course_payload: unknown } | null> {
  const { data } = await supabase
    .from("study_materials")
    .select("id, file_name, course_payload, user_id")
    .eq("course_id", courseId)
    .order("sort_order", { ascending: true })
    .limit(8);
  const rows = data ?? [];
  const owned = rows.find((r) => r.user_id === userId) ?? rows[0];
  if (!owned) return null;
  const ok = await canAccessStudyMaterial(supabase, userId, owned.id as string);
  if (!ok) return null;
  return {
    id: owned.id as string,
    file_name: (owned.file_name as string | null) ?? null,
    course_payload: owned.course_payload,
  };
}

/**
 * Resolve where a notes-sourced focus card should live: a course material
 * when the note is linked, otherwise the notes-only Review bucket.
 */
export async function resolveFocusDestination(
  supabase: SupabaseClient,
  userId: string,
  input: FocusSourceInput
): Promise<FocusDestination | { error: string; status: number }> {
  let sourceNoteId: string | null =
    input.noteId && isUuid(input.noteId) ? input.noteId : null;
  let sourceLabel = "Notes";
  let courseId: string | null = null;

  if (input.materialId && isUuid(input.materialId)) {
    const ok = await canAccessStudyMaterial(supabase, userId, input.materialId);
    if (!ok) return { error: "Not found.", status: 404 };
    const { data: mat } = await supabase
      .from("study_materials")
      .select("id, file_name, course_payload")
      .eq("id", input.materialId)
      .maybeSingle();
    if (!mat) return { error: "Not found.", status: 404 };
    return {
      materialId: mat.id as string,
      moduleId: firstModuleId(mat.course_payload, input.moduleId),
      sourceNoteId,
      sourceLabel:
        ((mat.file_name as string) || "").replace(/\.[a-z0-9]{2,5}$/i, "").trim() ||
        "Course notes",
    };
  }

  if (input.liveSessionId && isUuid(input.liveSessionId)) {
    const { data: session } = await supabase
      .from("live_lecture_sessions")
      .select("id, user_id, course_id, user_note_id, title")
      .eq("id", input.liveSessionId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!session) return { error: "Not found.", status: 404 };
    if (typeof session.user_note_id === "string") {
      sourceNoteId = session.user_note_id;
    }
    if (typeof session.title === "string" && session.title.trim()) {
      sourceLabel = session.title.trim();
    }
    if (typeof session.course_id === "string") {
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
    const { data: note } = await supabase
      .from("user_notes")
      .select("id, title, course_id")
      .eq("id", sourceNoteId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!note) return { error: "Not found.", status: 404 };
    if (typeof note.title === "string" && note.title.trim()) {
      sourceLabel = note.title.trim();
    }
    if (!courseId && typeof note.course_id === "string") {
      courseId = note.course_id;
    }
  } else if (input.noteId && isUuid(input.noteId)) {
    return { error: "Not found.", status: 404 };
  }

  if (courseId) {
    const mat = await materialForCourse(supabase, userId, courseId);
    if (mat) {
      return {
        materialId: mat.id,
        moduleId: firstModuleId(mat.course_payload, input.moduleId),
        sourceNoteId,
        sourceLabel:
          sourceLabel !== "Notes"
            ? sourceLabel
            : (mat.file_name || "").replace(/\.[a-z0-9]{2,5}$/i, "").trim() ||
              "Course notes",
      };
    }
  }

  return {
    materialId: null,
    moduleId: null,
    sourceNoteId,
    sourceLabel,
  };
}
