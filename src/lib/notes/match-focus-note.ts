import { isGenericFocusTitle } from "./notes-focus-bucket.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const STOP = new Set([
  "the",
  "and",
  "for",
  "that",
  "with",
  "this",
  "from",
  "which",
  "what",
  "when",
  "where",
  "into",
  "onto",
  "about",
  "their",
  "there",
  "have",
  "has",
  "were",
  "been",
  "being",
  "than",
  "then",
  "them",
  "they",
  "does",
  "did",
  "each",
  "other",
  "such",
  "only",
  "also",
  "more",
  "most",
  "some",
  "any",
  "all",
  "can",
  "could",
  "would",
  "should",
  "will",
  "may",
  "might",
  "must",
  "between",
  "among",
  "under",
  "over",
  "after",
  "before",
  "because",
  "while",
  "during",
  "through",
  "following",
  "according",
  "describe",
  "explain",
  "name",
  "best",
  "correctly",
  "primary",
  "context",
  "notes",
  "lecture",
]);

export type NoteMatchCandidate = {
  id: string;
  title: string;
  courseId: string | null;
  updatedAt: string | null;
  deleted: boolean;
  /** Notes-hub folder — a different origin from course materials / live sessions. */
  sectionId?: string | null;
};

export type LiveSessionMatchCandidate = {
  id: string;
  title: string;
  courseId: string | null;
  userNoteId: string | null;
  updatedAt: string | null;
  /** Live-notes body — used to re-home title-colliding focus cards. */
  notesText?: string | null;
};

export type FocusNoteMatch = {
  noteId: string;
  courseId: string | null;
  sessionId: string | null;
  /** True when several notes share this title and we refused to pick one. */
  ambiguous: boolean;
};

export type FocusSessionMatch = {
  sessionId: string;
  noteId: string | null;
  courseId: string | null;
  score: number;
};

function normTitle(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/** Flatten a personal-quiz `item` JSON blob into text for overlap scoring. */
export function focusCardText(item: unknown): string {
  if (item == null) return "";
  if (typeof item === "string") return item;
  if (typeof item !== "object") return String(item);
  const row = item as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of [
    "question",
    "prompt",
    "correct",
    "answer",
    "explanation",
    "rationale",
  ]) {
    const v = row[key];
    if (typeof v === "string" && v.trim()) parts.push(v.trim());
  }
  const options = row.options;
  if (Array.isArray(options)) {
    for (const opt of options) {
      if (typeof opt === "string" && opt.trim()) parts.push(opt.trim());
      else if (opt && typeof opt === "object") {
        const text = (opt as { text?: unknown }).text;
        if (typeof text === "string" && text.trim()) parts.push(text.trim());
      }
    }
  }
  return parts.join("\n");
}

function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []).filter(
    (w) => !STOP.has(w)
  );
}

/** Fraction of card tokens that appear in the live-notes corpus. */
export function contentOverlapScore(cardText: string, corpus: string): number {
  const card = tokens(cardText);
  if (card.length === 0) return 0;
  const hay = new Set(tokens(corpus));
  if (hay.size === 0) return 0;
  let hits = 0;
  for (const t of card) {
    if (hay.has(t)) hits += 1;
  }
  return hits / card.length;
}

/**
 * Restore a card whose stored `source_label` uniquely names a notes-hub
 * note, when it currently sits on a different origin (course live session /
 * PDF) whose display title is not that label.
 *
 * Exact title only — never "Lecture 4" vs "Lecture 4 - ER Targeting…".
 */
export function pickSectionNoteForStoredLabel(
  label: string,
  currentNote: NoteMatchCandidate | null,
  notes: NoteMatchCandidate[]
): string | null {
  const wanted = normTitle(label);
  if (!wanted || isGenericFocusTitle(label)) return null;
  if (currentNote?.sectionId) return null;
  if (currentNote && normTitle(currentNote.title) === wanted) return null;
  const matches = notes.filter(
    (n) => !n.deleted && n.sectionId && normTitle(n.title) === wanted
  );
  if (matches.length !== 1) return null;
  const target = matches[0]!;
  if (currentNote && currentNote.id === target.id) return null;
  return target.id;
}

/**
 * Pick a live session for a focus card whose source_label matches a lecture
 * session title. Same-title collisions across courses use notes-body overlap
 * (and optional preferredCourseId from the PDF the card is currently on).
 *
 * Never used to move a card that already has a stable source_note_id or
 * course material_id — those origins must stay put.
 */
export function pickLiveSessionForFocusCard(
  label: string,
  cardText: string,
  sessions: LiveSessionMatchCandidate[],
  opts?: { currentNoteId?: string | null; preferredCourseId?: string | null }
): FocusSessionMatch | null {
  const wanted = normTitle(label);
  if (!wanted || isGenericFocusTitle(label)) return null;

  let live = sessions.filter((s) => normTitle(s.title) === wanted);
  if (live.length === 0) return null;

  const preferred =
    opts?.preferredCourseId && UUID_RE.test(opts.preferredCourseId)
      ? opts.preferredCourseId
      : null;
  if (preferred) {
    const scoped = live.filter((s) => s.courseId === preferred);
    if (scoped.length > 0) live = scoped;
  }

  if (live.length === 1) {
    const only = live[0]!;
    return {
      sessionId: only.id,
      noteId: only.userNoteId,
      courseId: only.courseId,
      score: 1,
    };
  }

  const scored = live
    .map((session) => ({
      session,
      score: contentOverlapScore(cardText, session.notesText ?? ""),
    }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best) return null;
  const second = scored[1];

  const currentNoteId = opts?.currentNoteId ?? null;
  if (currentNoteId) {
    const current = scored.find((s) => s.session.userNoteId === currentNoteId);
    // Keep the existing link when it is already a top match.
    if (current && current.score >= best.score - 0.02 && current.score >= 0.06) {
      return {
        sessionId: current.session.id,
        noteId: current.session.userNoteId,
        courseId: current.session.courseId,
        score: current.score,
      };
    }
  }

  const margin = second ? best.score - second.score : best.score;
  if (best.score < 0.06) return null;
  if (second && margin < 0.02 && best.score < 0.12) return null;

  return {
    sessionId: best.session.id,
    noteId: best.session.userNoteId,
    courseId: best.session.courseId,
    score: best.score,
  };
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
  const sectioned = candidates.filter(
    (n) => typeof n.sectionId === "string" && n.sectionId
  );
  const courseOriginNotes = candidates.filter(
    (n) => n.courseId && !(typeof n.sectionId === "string" && n.sectionId)
  );
  // Notes-hub folder vs course lecture / live session: never pick by title.
  if (sectioned.length > 0 && (courseOriginNotes.length > 0 || live.length > 0)) {
    return {
      noteId: "",
      courseId: null,
      sessionId: null,
      ambiguous: true,
    };
  }

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
      // Live-session course wins over a stale stamped note.course_id.
      courseId: session?.courseId ?? note.courseId ?? preferred,
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
