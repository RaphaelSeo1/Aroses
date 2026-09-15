import { isGenericFocusTitle } from "./notes-focus-bucket.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type NoteMatchCandidate = {
  id: string;
  title: string;
  courseId: string | null;
  updatedAt: string | null;
  deleted: boolean;
};

export type LiveSessionMatchCandidate = {
  id: string;
  title: string;
  courseId: string | null;
  userNoteId: string | null;
  updatedAt: string | null;
};

export type FocusNoteMatch = {
  noteId: string;
  courseId: string | null;
  sessionId: string | null;
  /** True when several notes share this title and we refused to pick one. */
  ambiguous: boolean;
};

function normTitle(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Pick a single user_note for an orphan focus card's source_label.
 * Never merges distinct notes when more than one still matches after
 * preferring a live-session course.
 */
export function pickNoteForFocusLabel(
  label: string,
  notes: NoteMatchCandidate[],
  sessions: LiveSessionMatchCandidate[],
  preferredCourseId?: string | null
): FocusNoteMatch | null {
  const wanted = normTitle(label);
  if (!wanted || isGenericFocusTitle(label)) return null;

  const live = sessions.filter((s) => normTitle(s.title) === wanted);
  const preferred =
    (preferredCourseId && UUID_RE.test(preferredCourseId)
      ? preferredCourseId
      : null) ??
    live.find((s) => s.courseId)?.courseId ??
    null;

  const candidates = notes.filter(
    (n) => !n.deleted && normTitle(n.title) === wanted
  );

  const byCourse = preferred
    ? candidates.filter((n) => n.courseId === preferred)
    : candidates;
  const pool = byCourse.length > 0 ? byCourse : candidates;

  if (pool.length > 1) {
    return {
      noteId: "",
      courseId: pool.every((n) => n.courseId && n.courseId === pool[0]!.courseId)
        ? pool[0]!.courseId
        : preferred,
      sessionId: live[0]?.id ?? null,
      ambiguous: true,
    };
  }

  if (pool.length === 1) {
    const note = pool[0]!;
    const session =
      live.find((s) => s.userNoteId === note.id) ??
      live.find((s) => (preferred ? s.courseId === preferred : true)) ??
      live[0] ??
      null;
    return {
      noteId: note.id,
      courseId: note.courseId ?? session?.courseId ?? preferred,
      sessionId: session?.id ?? null,
      ambiguous: false,
    };
  }

  const sessionWithNote = live.find(
    (s) => typeof s.userNoteId === "string" && s.userNoteId
  );
  if (sessionWithNote?.userNoteId) {
    return {
      noteId: sessionWithNote.userNoteId,
      courseId: sessionWithNote.courseId ?? preferred,
      sessionId: sessionWithNote.id,
      ambiguous: false,
    };
  }

  const ranked = [...live].sort((a, b) => {
    if (preferred) {
      const aMatch = a.courseId === preferred ? 1 : 0;
      const bMatch = b.courseId === preferred ? 1 : 0;
      if (aMatch !== bMatch) return bMatch - aMatch;
    }
    const at = a.updatedAt ? Date.parse(a.updatedAt) : 0;
    const bt = b.updatedAt ? Date.parse(b.updatedAt) : 0;
    return bt - at;
  });
  const session = ranked[0];
  if (!session) return null;

  return {
    noteId: "",
    courseId: session.courseId ?? preferred,
    sessionId: session.id,
    ambiguous: false,
  };
}
