import {
  isGenericFocusTitle,
  isShortLectureTitle,
} from "./notes-focus-bucket.ts";

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
  sectionTitle?: string | null;
  courseTitle?: string | null;
  /** Live-notes / hub body — used to re-home remapped cards by overlap. */
  notesText?: string | null;
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

function distinctiveLectureTail(value: string): string | null {
  const stripped = (value ?? "")
    .trim()
    .replace(/^\s*lecture\s+\d+\s*[-–—:|]\s*/i, "");
  const n = normTitle(stripped);
  if (!n || isShortLectureTitle(n)) return null;
  if (n === normTitle(value)) {
    return n.length >= 16 ? n : null;
  }
  return n.length >= 8 ? n : null;
}

function lectureNumber(value: string): string | null {
  const m = normTitle(value).match(/^lecture\s+(\d+)\b/);
  return m ? m[1]! : null;
}

function hubSectionNotes(notes: NoteMatchCandidate[]): NoteMatchCandidate[] {
  return notes.filter(
    (n) => !n.deleted && typeof n.sectionId === "string" && n.sectionId
  );
}

function uniqueHubNote(
  matches: NoteMatchCandidate[],
  currentNote: NoteMatchCandidate | null
): string | null {
  if (matches.length !== 1) return null;
  const target = matches[0]!;
  if (currentNote && currentNote.id === target.id) return null;
  return target.id;
}

/** "MCB 104 (Fall 2026)" and "MCB 104 !" share a course code. */
export function courseCodeKey(title: string | null | undefined): string {
  return normTitle(title)
    .replace(/[!.]+/g, " ")
    .replace(/\s*\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function sectionRelatedToCourse(
  sectionTitle: string | null | undefined,
  courseTitle: string | null | undefined
): boolean {
  const section = courseCodeKey(sectionTitle);
  const course = courseCodeKey(courseTitle);
  if (!section || !course) return false;
  return (
    section === course ||
    section.startsWith(`${course} `) ||
    course.startsWith(`${section} `) ||
    section.startsWith(course) ||
    course.startsWith(section)
  );
}

function sameHubSection(
  a: NoteMatchCandidate | null,
  b: NoteMatchCandidate | null
): boolean {
  const left = a?.sectionId;
  const right = b?.sectionId;
  return Boolean(left && right && left === right);
}

function matchHubNoteByLongLabel(
  label: string,
  currentNote: NoteMatchCandidate | null,
  hub: NoteMatchCandidate[]
): string | null {
  const wanted = normTitle(label);
  if (!wanted || isGenericFocusTitle(label) || isShortLectureTitle(label)) {
    return null;
  }

  const exact = uniqueHubNote(
    hub.filter((n) => normTitle(n.title) === wanted),
    currentNote
  );
  if (exact) return exact;

  const labelTail = distinctiveLectureTail(label);
  if (!labelTail) return null;

  const mentioned = hub.filter((n) => {
    const title = normTitle(n.title);
    const noteTail = distinctiveLectureTail(n.title);
    if (title.length >= 16 && wanted.includes(title)) return true;
    if (noteTail && wanted.includes(noteTail)) return true;
    if (noteTail && labelTail.includes(noteTail)) return true;
    return false;
  });
  const fromMention = uniqueHubNote(mentioned, currentNote);
  if (fromMention) return fromMention;

  // Hub titles may have been shortened to "Lecture 2" while source_label
  // still has "Lecture 2 - Nuclear…". Unique lecture number in the hub.
  const lec = lectureNumber(label);
  if (!lec) return null;
  return uniqueHubNote(
    hub.filter((n) => lectureNumber(n.title) === lec),
    currentNote
  );
}

/**
 * Bare "Lecture 3" after a rewrite still maps back when the hub note in a
 * related folder has that lecture number and a long distinctive title.
 * PBHLTH Lecture 2 stays off MCB 104 ! because the course codes differ.
 */
function matchHubNoteByShortLecture(
  label: string,
  currentNote: NoteMatchCandidate | null,
  hub: NoteMatchCandidate[]
): string | null {
  if (!isShortLectureTitle(label)) return null;
  if (currentNote?.sectionId) return null;
  const lec = lectureNumber(label);
  if (!lec) return null;

  const longHub = hub.filter((n) => {
    if (lectureNumber(n.title) !== lec) return false;
    return Boolean(distinctiveLectureTail(n.title));
  });
  if (longHub.length !== 1) return null;
  const target = longHub[0]!;
  if (currentNote && currentNote.id === target.id) return null;

  const currentLec = currentNote ? lectureNumber(currentNote.title) : null;
  const currentIsShortCourseLecture =
    Boolean(currentNote) &&
    !currentNote!.sectionId &&
    (isShortLectureTitle(currentNote!.title) || currentLec === lec);
  if (!currentIsShortCourseLecture) return null;
  if (
    currentNote?.courseTitle &&
    sectionRelatedToCourse(target.sectionTitle, currentNote.courseTitle)
  ) {
    return target.id;
  }
  return null;
}

function matchHubNoteByContent(
  cardText: string,
  currentNote: NoteMatchCandidate | null,
  hub: NoteMatchCandidate[]
): string | null {
  const text = (cardText ?? "").trim();
  if (!text) return null;
  if (currentNote?.sectionId && !currentNote.deleted) return null;

  const scored = hub
    .filter((n) => (n.notesText ?? "").trim())
    .map((note) => ({
      note,
      score: contentOverlapScore(text, note.notesText ?? ""),
    }))
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best) return null;
  const second = scored[1];
  const margin = second ? best.score - second.score : best.score;
  if (best.score < 0.12) return null;
  if (second && margin < 0.02 && best.score < 0.2) return null;
  if (currentNote && currentNote.id === best.note.id) return null;
  return best.note.id;
}

/**
 * Restore a card whose stored `source_label` uniquely names a notes-hub
 * note after a previous title-match parked it on a course lecture / PDF.
 *
 * Prefers an existing hub `section_id` origin. Never uses a bare
 * "Lecture 4" collision unless the parked row is a course lecture whose
 * course name matches the hub folder (MCB 104 vs MCB 104 !). Long labels
 * ("ER Targeting…", "Ran GTPase…", "Chromatin Structure…") can reattach
 * even when the hub row was shortened to "Lecture N".
 */
export function pickSectionNoteForStoredLabel(
  label: string,
  currentNote: NoteMatchCandidate | null,
  notes: NoteMatchCandidate[],
  cardText?: string | null
): string | null {
  const wanted = normTitle(label);
  if (!wanted || isGenericFocusTitle(label)) return null;

  const hub = hubSectionNotes(notes);
  const sameSectionHub = currentNote?.sectionId
    ? hub.filter((n) => n.sectionId === currentNote.sectionId)
    : hub;

  if (currentNote?.sectionId && !currentNote.deleted) {
    // Already on a hub folder row. Only move to a sibling in that folder
    // when the stored label uniquely names a different hub note.
    const sibling = matchHubNoteByLongLabel(label, currentNote, sameSectionHub);
    if (sibling) {
      const target = notes.find((n) => n.id === sibling) ?? null;
      if (sameHubSection(currentNote, target)) return sibling;
    }
    return null;
  }

  const byLong = matchHubNoteByLongLabel(label, currentNote, hub);
  if (byLong) return byLong;

  const byShort = matchHubNoteByShortLecture(label, currentNote, hub);
  if (byShort) return byShort;

  return matchHubNoteByContent(cardText ?? "", currentNote, hub);
}

export type ResolveFocusCardNoteOpts = {
  cardText?: string | null;
  materialId?: string | null;
};

/**
 * Read-time origin for a personal card. Hub `section_id` wins; otherwise a
 * unique stored label / related hub lecture / note-body overlap can point
 * back at a hub note. Never writes.
 */
export function resolveFocusCardNoteId(
  sourceNoteId: string | null | undefined,
  sourceLabel: string | null | undefined,
  notes: NoteMatchCandidate[],
  opts?: ResolveFocusCardNoteOpts
): string | null {
  const noteId =
    typeof sourceNoteId === "string" && UUID_RE.test(sourceNoteId.trim())
      ? sourceNoteId.trim()
      : null;
  const materialId =
    typeof opts?.materialId === "string" && UUID_RE.test(opts.materialId.trim())
      ? opts.materialId.trim()
      : null;
  const current = noteId
    ? (notes.find((n) => n.id === noteId) ?? null)
    : null;

  // Course-native PDF cards with no note id must stay on the material.
  if (materialId && !noteId) return null;

  const restored = pickSectionNoteForStoredLabel(
    typeof sourceLabel === "string" ? sourceLabel : "",
    current,
    notes,
    opts?.cardText
  );
  if (restored) return restored;
  if (current?.sectionId && !current.deleted) return current.id;
  return noteId;
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
