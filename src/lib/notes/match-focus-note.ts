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
  const liveCourseIds = [
    ...new Set(
      live
        .map((s) => s.courseId)
        .filter((id): id is string => Boolean(id && UUID_RE.test(id)))
    ),
  ];
  const preferred =
    (preferredCourseId && UUID_RE.test(preferredCourseId)
      ? preferredCourseId
      : null) ?? (liveCourseIds.length === 1 ? liveCourseIds[0]! : null);

  const candidates = notes.filter(
    (n) => !n.deleted && normTitle(n.title) === wanted
  );
  const candidateCourseIds = [
    ...new Set(
      candidates
        .map((n) => n.courseId)
        .filter((id): id is string => Boolean(id && UUID_RE.test(id)))
    ),
  ];

  // Same title in two courses (PBHLTH Lecture 2 vs MCB 104 Lecture 2) must
  // not collapse into whichever session happened to sort first.
  if (!preferred && (liveCourseIds.length > 1 || candidateCourseIds.length > 1)) {
    return {
      noteId: "",
      courseId: null,
      sessionId: null,
      ambiguous: true,
    };
  }

  const pool = preferred
    ? candidates.filter((n) => !n.courseId || n.courseId === preferred)
    : candidates;

  if (pool.length > 1) {
    return {
      noteId: "",
      courseId: pool.every((n) => n.courseId && n.courseId === pool[0]!.courseId)
        ? pool[0]!.courseId
        : preferred,
      sessionId: sessionOnCourse(live, preferred)?.id ?? null,
      ambiguous: true,
    };
  }

  if (pool.length === 1) {
    const note = pool[0]!;
    const session =
      live.find((s) => s.userNoteId === note.id) ??
      sessionOnCourse(live, note.courseId ?? preferred);
    return {
      noteId: note.id,
      courseId: note.courseId ?? session?.courseId ?? preferred,
      sessionId: session?.id ?? null,
      ambiguous: false,
    };
  }

  const scopedLive = preferred
    ? live.filter((s) => !s.courseId || s.courseId === preferred)
    : live;
  const sessionWithNote = scopedLive.find(
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

  const ranked = [...scopedLive].sort((a, b) => {
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

function sessionOnCourse(
  live: LiveSessionMatchCandidate[],
  courseId: string | null
): LiveSessionMatchCandidate | null {
  if (!courseId) return null;
  const matches = live.filter((s) => s.courseId === courseId);
  if (matches.length === 0) return null;
  return (
    [...matches].sort((a, b) => {
      const at = a.updatedAt ? Date.parse(a.updatedAt) : 0;
      const bt = b.updatedAt ? Date.parse(b.updatedAt) : 0;
      return bt - at;
    })[0] ?? null
  );
}
