/**
 * Mentored Learning mode — shared types.
 *
 * The mentored experience walks a student through a `CourseModule` in
 * small chunks, where each chunk is `{ concept, explanation, checkQuestion }`.
 * Voice + text are both supported per-card; the student picks during
 * onboarding and can switch any time.
 *
 * Database tables backing these types (see migration 032):
 *   - user_course_onboarding   ⇄ MentoredOnboardingRecord
 *   - user_mentored_sessions   ⇄ MentoredSessionRecord
 *   - user_course_mode_prefs   ⇄ CourseModeRecord
 */

import type { CourseQuizMcqItem } from "@/types/course";

// ---------------------------------------------------------------------------
// Mode toggle
// ---------------------------------------------------------------------------

/** Which top-level mode the course is currently in. */
export type CourseMode = "mentored" | "free";

export type CourseModeRecord = {
  userId: string;
  materialId: string;
  mode: CourseMode;
  updatedAt: string;
};

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------

export type KnowledgeLevel = "beginner" | "intermediate" | "advanced";

export type PathChoice = "personalized" | "original";

export type InteractionMode = "voice" | "text";

/** One Q+A pair from the goals/background interview. */
export type GoalsAnswer = {
  question: string;
  answer: string;
};

/** Stored shape of the onboarding MCQ + the student's answers. */
export type LevelQuizState = {
  questions: CourseQuizMcqItem[];
  /**
   * Index of the chosen choice per question. `-1` means unanswered.
   * Same length as `questions`.
   */
  answers: number[];
  /** Score 0..100 — used to suggest a knowledge level. */
  scorePct: number;
};

/**
 * AI-extracted, structured view of the student's free-text onboarding
 * answers. Used to personalize Rose's teaching in every turn:
 *
 *   - `knownTopics` → topics Rose can fast-forward through with a
 *     quick recap rather than a from-zero explanation.
 *   - `focusAreas`  → topics Rose should spend extra time on, with
 *     more examples and deeper questions.
 *   - `experienceLevel` → calibrates vocabulary complexity, depth,
 *     and assumed prior knowledge. Can be updated mid-course when
 *     the student says things like "this is too basic" or "slow
 *     down, I don't know this stuff".
 *   - `summary` → one-sentence natural-language summary the prompt
 *     can paste in directly.
 *
 * An empty object (`{}`) means "not yet extracted" — the runner will
 * lazily extract from `goals` on first turn.
 */
export type MentoredPersonalization = {
  knownTopics?: string[];
  focusAreas?: string[];
  experienceLevel?: KnowledgeLevel;
  summary?: string;
};

/** Full row shape (after the API normalizes snake_case → camelCase). */
export type MentoredOnboardingRecord = {
  id: string;
  userId: string;
  materialId: string;
  goals: GoalsAnswer[];
  knowledgeLevel: KnowledgeLevel;
  levelQuiz: LevelQuizState;
  pathChoice: PathChoice;
  interactionMode: InteractionMode;
  personalization: MentoredPersonalization;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Patch payload accepted by the onboarding upsert API. */
export type MentoredOnboardingPatch = Partial<{
  goals: GoalsAnswer[];
  knowledgeLevel: KnowledgeLevel;
  levelQuiz: LevelQuizState;
  pathChoice: PathChoice;
  interactionMode: InteractionMode;
  personalization: MentoredPersonalization;
  completedAt: string | null;
}>;

// ---------------------------------------------------------------------------
// Visual assets & whiteboard (shared across mentored, quizzes, review)
// ---------------------------------------------------------------------------

export type VisualAssetDisplayMode = "inline" | "whiteboard";

/** Reference to an extracted PDF visual inside a lesson segment. */
export type LessonVisualAssetRef = {
  assetId: string;
  type: "diagram" | "table" | "chart" | "image";
  sourcePage: number;
  displayMode?: VisualAssetDisplayMode;
  teachingPurpose?: string;
};

export type WhiteboardPoint = { x: number; y: number };

/** Semantic colors reused across a course (excitatory / inhibitory / exam). */
export type WhiteboardActionColor =
  | "default"
  | "excitatory"
  | "inhibitory"
  | "highlight";

/** Tutor-driven whiteboard overlay actions (normalized 0–100 coords). */
export type WhiteboardAction =
  | { type: "show_asset"; assetId: string; cue?: string; id?: string }
  | {
      type: "show_table";
      /** Optional phrase Rose says when anchoring the source table. */
      cue?: string;
      id?: string;
    }
  | {
      type: "highlight_bbox";
      assetId?: string;
      bbox: [number, number, number, number];
      cue?: string;
      color?: WhiteboardActionColor;
      id?: string;
    }
  | {
      type: "draw_arrow";
      from: WhiteboardPoint;
      to: WhiteboardPoint;
      cue?: string;
      color?: WhiteboardActionColor;
      id?: string;
    }
  | {
      type: "add_label";
      text: string;
      position: WhiteboardPoint;
      cue?: string;
      color?: WhiteboardActionColor;
      id?: string;
    }
  | { type: "clear"; id?: string }
  | { type: "clear_except"; keepIds: string[]; id?: string };

export type WhiteboardState = {
  assetId?: string | null;
  /** True when the source lesson table is pinned as the board substrate. */
  tableAnchored?: boolean;
  actions: WhiteboardAction[];
  /** How many actions are visible during progressive reveal (live canvas). */
  revealedCount?: number;
};

export type TutorMode = "presenting" | "paused" | "answering" | "resuming";

// ---------------------------------------------------------------------------
// Lesson plan
// ---------------------------------------------------------------------------

/**
 * One teach-then-check unit. The AI explains `concept` using `explanation`,
 * then asks `checkQuestion`. The student answers via voice or text. The
 * server-side classifier compares the response to `referenceAnswer` /
 * `keyPoints` to decide correct/partial/wrong.
 */
export type MentoredLessonChunk = {
  /** Stable id so we can refer to a chunk across saves. */
  id: string;
  /** 1-2 sentence concept title (shown as the heading for this chunk). */
  concept: string;
  /**
   * The teacher's natural-language explanation. ~3-6 sentences, written to
   * be spoken. Always plain prose — no markdown / lists.
   */
  explanation: string;
  /** Optional short analogy the AI can fall back to on a wrong answer. */
  analogy?: string;
  /** Question read aloud + shown on screen after the explanation. */
  checkQuestion: string;
  /** A clean reference answer used by the grader. */
  referenceAnswer: string;
  /** Bullet-style key points the student's answer should hit. */
  keyPoints: string[];
  /**
   * Optional lesson-content excerpt id this chunk maps to (used to scroll +
   * highlight the right paragraph on the course page).
   */
  sourceLessonIndex?: number;
  /**
   * Short phrases (1-4 words each) that appear verbatim somewhere in the
   * source lesson content. The immersive runner glows these in the source
   * lesson glass panel while the AI is teaching this chunk.
   *
   * The lesson plan generator extracts them. Match is case-insensitive but
   * preserves the original surface form in the rendered panel.
   */
  keyTerms?: string[];
  /** PDF visual assets Rose should reference while teaching this chunk. */
  visualAssetIds?: string[];
  /** Planned whiteboard sequence (show figure, highlight region, etc.). */
  whiteboardActions?: WhiteboardAction[];
};

/** Cached plan for a module — produced by Claude on first entry. */
export type MentoredLessonPlan = {
  moduleId: number;
  /** The version of the prompt + model this plan was generated with. */
  generatorVersion: number;
  chunks: MentoredLessonChunk[];
};

// ---------------------------------------------------------------------------
// Live session state
// ---------------------------------------------------------------------------

/** Per-chunk attempt tracking (resets when the student advances). */
export type MentoredAttemptState = {
  /** Which chunk this attempt-state belongs to. */
  chunkIndex: number;
  /** Number of times the student has answered this chunk (correct OR wrong). */
  attempts: number;
  /** Result of the most recent eval. */
  lastEval: "correct" | "partial" | "wrong" | null;
};

/** One entry in the resumable history log. */
export type MentoredHistoryEntry = {
  at: string;
  moduleId: number;
  chunkIndex: number;
  concept: string;
  evaluation: "correct" | "partial" | "wrong" | "skipped";
};

export type MentoredSessionRecord = {
  id: string;
  userId: string;
  materialId: string;
  moduleId: number;
  chunkIndex: number;
  lessonPlan: MentoredLessonPlan | null;
  lastRecap: string | null;
  attemptState: MentoredAttemptState;
  history: MentoredHistoryEntry[];
  /** Live tutor phase — presenting, paused on question, answering, resuming. */
  tutorMode?: TutorMode;
  /** Whiteboard overlays preserved across interruptions. */
  whiteboardState?: WhiteboardState;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
};

/** Patch payload accepted by the session upsert API. */
export type MentoredSessionPatch = Partial<{
  moduleId: number;
  chunkIndex: number;
  lessonPlan: MentoredLessonPlan | null;
  lastRecap: string | null;
  attemptState: MentoredAttemptState;
  /** When provided, the entry is appended to `history`. */
  appendHistory: MentoredHistoryEntry;
  tutorMode?: TutorMode;
  whiteboardState?: WhiteboardState;
}>;

// ---------------------------------------------------------------------------
// Turn classifier
// ---------------------------------------------------------------------------

/**
 * The classifier on the server reads each student utterance during a
 * mentored chunk and tags it with one of these intents. The UI then knows
 * whether to advance, slow down, branch into a tangent, etc.
 */
export type MentoredIntent =
  | "answer_correct"
  | "answer_partial"
  | "answer_wrong"
  | "pace_slower"
  | "pace_faster"
  | "skip_concept"
  | "move_on"
  | "tangent_question"
  | "request_repeat"
  | "request_pause"
  | "request_clarify"
  /**
   * The student acknowledged a SOFT check-in ("makes sense", "yeah I follow")
   * for a non-critical concept. Rose may continue without forcing the formal
   * check question. Does not burn an attempt or require the banner question.
   */
  | "check_in"
  | "other";

export type MentoredTurnRequest = {
  materialId: string;
  moduleId: number;
  chunk: MentoredLessonChunk;
  attempts: number;
  studentUtterance: string;
  knowledgeLevel: KnowledgeLevel;
  /**
   * When the student barged in mid-utterance, this is the text Rose had
   * already spoken aloud (and the student actually heard) up to the
   * cut. The turn prompt uses this so Rose can acknowledge the
   * interruption and offer to resume rather than restarting cold.
   */
  interruptedAfter?: string;
  /**
   * Seconds since Rose last asked a check question in this session.
   * Drives smart question-timing in the turn prompt — Rose holds off
   * on a new check if it's been less than ~30s, and is more likely
   * to ask after ~90s of monologue. Pass `null` if there's been no
   * prior check this session.
   */
  secondsSinceLastCheck?: number | null;
  /**
   * Seconds since the student last said anything. Long silences are
   * a signal Rose may want to gently check in. Pass `null` when no
   * prior utterance exists yet.
   */
  secondsSinceStudentSpoke?: number | null;
  /**
   * In-session teaching language override (from the mentored UI picker).
   * When set, Rose replies in this language instead of the course default.
   */
  outputLanguage?: import("@/lib/course-output-language").CourseOutputLanguage;
  /** Lesson title for asset retrieval (optional). */
  lessonTitle?: string;
  /**
   * False when this chunk's explanation has not been delivered yet — the
   * student may still be answering the session-opening welcome.
   */
  chunkTeachingStarted?: boolean;
};

export type MentoredTurnResponse = {
  intent: MentoredIntent;
  /** Natural-language reply the AI should speak/show. */
  reply: string;
  /** True when the chunk is "complete" and the runner can advance. */
  advance: boolean;
  /**
   * True when this concept should be silently added to the student's
   * Focused Review queue. The route handles the insert.
   */
  addToFocusedReview: boolean;
  /** Rose requests a specific uploaded PDF asset on the whiteboard. */
  showAsset?: string | null;
  /** Overlay actions (highlights, arrows, labels) for the whiteboard. */
  whiteboardActions?: WhiteboardAction[];
};
