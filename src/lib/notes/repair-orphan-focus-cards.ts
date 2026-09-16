import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingDbColumnError } from "@/lib/supabase/schema-compat";
import { isUuid } from "@/lib/voice-tutor/uuid";
import { isGenericFocusTitle } from "@/lib/notes/notes-focus-bucket";
import { ensureLiveSessionUserNote } from "@/lib/live-notes/sync-standalone-note";
import {
  pickNoteForFocusLabel,
  type LiveSessionMatchCandidate,
  type NoteMatchCandidate,
} from "@/lib/notes/match-focus-note";

export {
  pickNoteForFocusLabel,
  type FocusNoteMatch,
  type LiveSessionMatchCandidate,
  type NoteMatchCandidate,
} from "@/lib/notes/match-focus-note";

function normTitle(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function newer(a: string | null, b: string | null): boolean {
  const at = a ? Date.parse(a) : 0;
  const bt = b ? Date.parse(b) : 0;
  return at > bt;
}

type OrphanRow = {
  id: string;
  source_label?: string | null;
  source_note_id?: string | null;
  material_id?: string | null;
};

function asId(value: unknown): string | null {
  return typeof value === "string" && isUuid(value) ? value : null;
}

/**
 * Fill null `source_note_id` on notes-only personal cards, and copy
 * `course_id` onto the linked user_notes row from the live session that
 * owns it — including when a stale title-match stamped the wrong course.
 * Never writes `material_id` — notes-origin cards must not attach to a PDF.
 */
export async function repairOrphanNotesFocusCards(
  supabase: SupabaseClient,
  userId: string
): Promise<void> {
  const first = await supabase
    .from("user_personal_quiz_items")
    .select("id, source_label, source_note_id, material_id")
    .eq("user_id", userId)
    .limit(800);
  let rows: OrphanRow[] | null = first.data as OrphanRow[] | null;
  if (
    first.error &&
    isMissingDbColumnError(first.error, "source_label", "source_note_id")
  ) {
    return;
  }
  if (first.error) {
    console.error("[repairOrphanNotesFocusCards load]", first.error);
    return;
  }

  const orphans = (rows ?? []).filter(
    (row) => !asId(row.source_note_id) && !asId(row.material_id)
  );
  const labeled = orphans.filter(
    (row) =>
      typeof row.source_label === "string" &&
      !isGenericFocusTitle(row.source_label)
  );
  const linkedNoteIds = [
    ...new Set(
      (rows ?? [])
        .map((row) => asId(row.source_note_id))
        .filter((id): id is string => Boolean(id))
    ),
  ];

  if (labeled.length === 0 && linkedNoteIds.length === 0) return;

  const labels = [
    ...new Set(
      labeled
        .map((row) => (row.source_label as string).trim())
        .filter(Boolean)
    ),
  ];

  const notes: NoteMatchCandidate[] = [];
  const noteSelect = await supabase
    .from("user_notes")
    .select("id, title, course_id, updated_at, deleted_at")
    .eq("user_id", userId)
    .limit(400);
  if (noteSelect.error && isMissingDbColumnError(noteSelect.error, "deleted_at")) {
    const fallback = await supabase
      .from("user_notes")
      .select("id, title, course_id, updated_at")
      .eq("user_id", userId)
      .limit(400);
    for (const raw of fallback.data ?? []) {
      notes.push({
        id: raw.id as string,
        title: typeof raw.title === "string" ? raw.title : "",
        courseId: asId(raw.course_id),
        updatedAt: typeof raw.updated_at === "string" ? raw.updated_at : null,
        deleted: false,
      });
    }
  } else if (noteSelect.error && isMissingDbColumnError(noteSelect.error, "course_id")) {
    const fallback = await supabase
      .from("user_notes")
      .select("id, title, updated_at")
      .eq("user_id", userId)
      .limit(400);
    for (const raw of fallback.data ?? []) {
      notes.push({
        id: raw.id as string,
        title: typeof raw.title === "string" ? raw.title : "",
        courseId: null,
        updatedAt: typeof raw.updated_at === "string" ? raw.updated_at : null,
        deleted: false,
      });
    }
  } else if (noteSelect.error) {
    console.error("[repairOrphanNotesFocusCards notes]", noteSelect.error);
  } else {
    for (const raw of noteSelect.data ?? []) {
      notes.push({
        id: raw.id as string,
        title: typeof raw.title === "string" ? raw.title : "",
        courseId: asId(raw.course_id),
        updatedAt: typeof raw.updated_at === "string" ? raw.updated_at : null,
        deleted: Boolean((raw as { deleted_at?: unknown }).deleted_at),
      });
    }
  }

  const sessions: LiveSessionMatchCandidate[] = [];
  const sessionSelect = await supabase
    .from("live_lecture_sessions")
    .select("id, title, course_id, user_note_id, updated_at")
    .eq("user_id", userId)
    .limit(400);
  if (
    sessionSelect.error &&
    isMissingDbColumnError(sessionSelect.error, "user_note_id")
  ) {
    const fallback = await supabase
      .from("live_lecture_sessions")
      .select("id, title, course_id, updated_at")
      .eq("user_id", userId)
      .limit(400);
    for (const raw of fallback.data ?? []) {
      sessions.push({
        id: raw.id as string,
        title: typeof raw.title === "string" ? raw.title : "",
        courseId: asId(raw.course_id),
        userNoteId: null,
        updatedAt: typeof raw.updated_at === "string" ? raw.updated_at : null,
      });
    }
  } else if (!sessionSelect.error) {
    for (const raw of sessionSelect.data ?? []) {
      sessions.push({
        id: raw.id as string,
        title: typeof raw.title === "string" ? raw.title : "",
        courseId: asId(raw.course_id),
        userNoteId: asId(raw.user_note_id),
        updatedAt: typeof raw.updated_at === "string" ? raw.updated_at : null,
      });
    }
  }

  const noteIdByLabel = new Map<string, string>();
  for (const label of labels) {
    const match = pickNoteForFocusLabel(label, notes, sessions);
    if (!match || match.ambiguous) continue;

    let noteId = match.noteId;
    if (!noteId && match.sessionId) {
      const ensured = await ensureLiveSessionUserNote(
        supabase,
        match.sessionId,
        userId
      );
      noteId = ensured?.noteId ?? "";
      if (ensured?.courseId && noteId) {
        match.courseId = ensured.courseId;
      }
    }
    if (!noteId) continue;
    noteIdByLabel.set(normTitle(label), noteId);
    if (match.courseId) {
      await supabase
        .from("user_notes")
        .update({
          course_id: match.courseId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", noteId)
        .eq("user_id", userId)
        .is("course_id", null);
    }
  }

  const idsByNote = new Map<string, string[]>();
  for (const row of labeled) {
    const noteId = noteIdByLabel.get(normTitle(row.source_label as string));
    if (!noteId) continue;
    const list = idsByNote.get(noteId) ?? [];
    list.push(row.id);
    idsByNote.set(noteId, list);
  }
  for (const [noteId, ids] of idsByNote) {
    const { error } = await supabase
      .from("user_personal_quiz_items")
      .update({ source_note_id: noteId })
      .eq("user_id", userId)
      .is("source_note_id", null)
      .is("material_id", null)
      .in("id", ids);
    if (error && !isMissingDbColumnError(error, "source_note_id")) {
      console.error("[repairOrphanNotesFocusCards patch]", error);
    }
  }

  if (linkedNoteIds.length === 0 && sessions.every((s) => !s.userNoteId)) {
    return;
  }

  const noteById = new Map(notes.map((n) => [n.id, n]));
  const sessionByNoteId = new Map<string, LiveSessionMatchCandidate>();
  for (const session of sessions) {
    if (!session.userNoteId) continue;
    const existing = sessionByNoteId.get(session.userNoteId);
    if (!existing || newer(session.updatedAt, existing.updatedAt)) {
      sessionByNoteId.set(session.userNoteId, session);
    }
  }
  const noteIdsToAlign = new Set([
    ...linkedNoteIds,
    ...[...sessionByNoteId.keys()],
  ]);
  for (const noteId of noteIdsToAlign) {
    const session = sessionByNoteId.get(noteId);
    const courseId = session?.courseId ?? null;
    if (!courseId) continue;
    const note = noteById.get(noteId);
    if (note?.courseId === courseId) continue;
    const { error } = await supabase
      .from("user_notes")
      .update({
        course_id: courseId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", noteId)
      .eq("user_id", userId);
    if (error && !isMissingDbColumnError(error, "course_id")) {
      console.error("[repairOrphanNotesFocusCards note course]", error);
    }
  }

  const attachedToPdf = (rows ?? []).filter(
    (row) => asId(row.source_note_id) && asId(row.material_id)
  );
  if (attachedToPdf.length === 0) return;
  const detachIds = attachedToPdf.map((row) => row.id);
  const { error: detachErr } = await supabase
    .from("user_personal_quiz_items")
    .update({ material_id: null, module_id: null })
    .eq("user_id", userId)
    .in("id", detachIds);
  if (detachErr && !isMissingDbColumnError(detachErr, "source_note_id")) {
    console.error("[repairOrphanNotesFocusCards detach material]", detachErr);
  }
}
