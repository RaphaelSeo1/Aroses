import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingDbColumnError } from "@/lib/supabase/schema-compat";
import { isUuid } from "@/lib/voice-tutor/uuid";
import {
  isGenericFocusTitle,
  isNotesOriginFocusCard,
} from "@/lib/notes/notes-focus-bucket";
import { ensureLiveSessionUserNote } from "@/lib/live-notes/sync-standalone-note";
import {
  focusCardText,
  pickLiveSessionForFocusCard,
  pickNoteForFocusLabel,
  type LiveSessionMatchCandidate,
  type NoteMatchCandidate,
} from "@/lib/notes/match-focus-note";

export {
  pickNoteForFocusLabel,
  pickLiveSessionForFocusCard,
  focusCardText,
  type FocusNoteMatch,
  type FocusSessionMatch,
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
  item?: unknown;
};

function asId(value: unknown): string | null {
  return typeof value === "string" && isUuid(value) ? value : null;
}

async function patchNoteCourse(
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
    console.error("[repairOrphanNotesFocusCards note course]", error);
  }
}

/**
 * Fill null `source_note_id` on notes-only personal cards, ensure live
 * sessions have standalone notes, overwrite stale `user_notes.course_id`
 * from the owning live session, and re-home title-colliding cards onto the
 * session whose notes body matches the card (e.g. PBHLTH 162A Lecture 2
 * bacteria cards that were title-matched onto MCB 104's Lecture 2 note).
 * Never writes `material_id` — notes-origin cards must not attach to a PDF.
 */
export async function repairOrphanNotesFocusCards(
  supabase: SupabaseClient,
  userId: string
): Promise<void> {
  const first = await supabase
    .from("user_personal_quiz_items")
    .select("id, source_label, source_note_id, material_id, item")
    .eq("user_id", userId)
    .limit(800);
  let rows: OrphanRow[] | null = first.data as OrphanRow[] | null;
  if (
    first.error &&
    isMissingDbColumnError(first.error, "source_label", "source_note_id")
  ) {
    return;
  }
  if (first.error && isMissingDbColumnError(first.error, "item")) {
    const fallback = await supabase
      .from("user_personal_quiz_items")
      .select("id, source_label, source_note_id, material_id")
      .eq("user_id", userId)
      .limit(800);
    rows = (fallback.data as OrphanRow[] | null) ?? null;
    if (fallback.error) {
      console.error("[repairOrphanNotesFocusCards load]", fallback.error);
      return;
    }
  } else if (first.error) {
    console.error("[repairOrphanNotesFocusCards load]", first.error);
    return;
  }

  const allRows = rows ?? [];
  const orphans = allRows.filter(
    (row) => !asId(row.source_note_id) && !asId(row.material_id)
  );
  const labeled = orphans.filter(
    (row) =>
      typeof row.source_label === "string" &&
      !isGenericFocusTitle(row.source_label)
  );
  const notesOriginRows = allRows.filter((row) =>
    isNotesOriginFocusCard({
      materialId: row.material_id,
      sourceNoteId: row.source_note_id,
    })
  );
  const linkedNoteIds = [
    ...new Set(
      allRows
        .map((row) => asId(row.source_note_id))
        .filter((id): id is string => Boolean(id))
    ),
  ];

  const labels = [
    ...new Set(
      [...labeled, ...notesOriginRows]
        .map((row) =>
          typeof row.source_label === "string" ? row.source_label.trim() : ""
        )
        .filter((label) => label && !isGenericFocusTitle(label))
    ),
  ];
  const labelSet = new Set(labels.map((l) => normTitle(l)));

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
    .select("id, title, course_id, user_note_id, updated_at, notes_text")
    .eq("user_id", userId)
    .limit(400);
  if (
    sessionSelect.error &&
    isMissingDbColumnError(sessionSelect.error, "user_note_id", "notes_text")
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
        notesText: null,
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
        notesText:
          typeof (raw as { notes_text?: unknown }).notes_text === "string"
            ? ((raw as { notes_text: string }).notes_text)
            : null,
      });
    }
  } else {
    console.error("[repairOrphanNotesFocusCards sessions]", sessionSelect.error);
  }

  // Ensure live sessions that share a focus-card label get their own note
  // (never reuse another course's "Lecture 2" note by title).
  for (let i = 0; i < sessions.length; i++) {
    const session = sessions[i]!;
    if (session.userNoteId) continue;
    if (!labelSet.has(normTitle(session.title))) continue;
    const ensured = await ensureLiveSessionUserNote(
      supabase,
      session.id,
      userId
    );
    if (!ensured?.noteId) continue;
    sessions[i] = {
      ...session,
      userNoteId: ensured.noteId,
      courseId: ensured.courseId ?? session.courseId,
    };
    const existing = notes.find((n) => n.id === ensured.noteId);
    if (!existing) {
      notes.push({
        id: ensured.noteId,
        title: session.title,
        courseId: ensured.courseId ?? session.courseId,
        updatedAt: new Date().toISOString(),
        deleted: false,
      });
    } else if (ensured.courseId && existing.courseId !== ensured.courseId) {
      existing.courseId = ensured.courseId;
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
      const sess = sessions.find((s) => s.id === match.sessionId);
      if (sess && noteId) {
        sess.userNoteId = noteId;
        if (ensured?.courseId) sess.courseId = ensured.courseId;
      }
    }
    if (!noteId) continue;
    noteIdByLabel.set(normTitle(label), noteId);
    if (match.courseId) {
      // Overwrite stale stamps — title-match used to pin the wrong course.
      await patchNoteCourse(supabase, userId, noteId, match.courseId);
      const note = notes.find((n) => n.id === noteId);
      if (note) note.courseId = match.courseId;
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

  // Re-home already-linked cards that title-match landed on the wrong course's
  // note (PBHLTH bacteria cards sitting on MCB Lecture 2).
  const rehomeByNote = new Map<string, string[]>();
  for (const row of notesOriginRows) {
    const label =
      typeof row.source_label === "string" ? row.source_label.trim() : "";
    if (!label || isGenericFocusTitle(label)) continue;
    const currentNoteId = asId(row.source_note_id);
    const picked = pickLiveSessionForFocusCard(
      label,
      focusCardText(row.item),
      sessions,
      { currentNoteId }
    );
    if (!picked?.courseId) continue;

    let targetNoteId = picked.noteId;
    if (!targetNoteId && picked.sessionId) {
      const ensured = await ensureLiveSessionUserNote(
        supabase,
        picked.sessionId,
        userId
      );
      targetNoteId = ensured?.noteId ?? null;
      const sess = sessions.find((s) => s.id === picked.sessionId);
      if (sess && targetNoteId) {
        sess.userNoteId = targetNoteId;
        if (ensured?.courseId) sess.courseId = ensured.courseId;
      }
    }
    if (!targetNoteId) continue;
    if (currentNoteId === targetNoteId) continue;

    const list = rehomeByNote.get(targetNoteId) ?? [];
    list.push(row.id);
    rehomeByNote.set(targetNoteId, list);
  }
  for (const [noteId, ids] of rehomeByNote) {
    const { error } = await supabase
      .from("user_personal_quiz_items")
      .update({
        source_note_id: noteId,
        material_id: null,
        module_id: null,
      })
      .eq("user_id", userId)
      .in("id", ids);
    if (error && !isMissingDbColumnError(error, "source_note_id")) {
      console.error("[repairOrphanNotesFocusCards rehome]", error);
    }
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
    ...[...rehomeByNote.keys()],
  ]);
  for (const noteId of noteIdsToAlign) {
    const session = sessionByNoteId.get(noteId);
    const courseId = session?.courseId ?? null;
    if (!courseId) continue;
    const note = noteById.get(noteId);
    if (note?.courseId === courseId) continue;
    await patchNoteCourse(supabase, userId, noteId, courseId);
    if (note) note.courseId = courseId;
  }

  const attachedToPdf = allRows.filter(
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
