/**
 * Tutor Session types — one-on-one ad-hoc tutoring with Rose.
 *
 * Distinct from Mentored Learning (course-based). A session has a
 * conversation transcript, optional reference uploads, live notes,
 * and an auto-generated recap. Never produces a course.
 */

export type TutorSessionModeTag =
  | "exam_prep"
  | "homework_help"
  | "concept_review"
  | "quiz_me"
  | "exploring";

export type TutorSessionStatus = "active" | "paused" | "ended";

export type TutorSessionRecapStatus =
  | "idle"
  | "generating"
  | "ready"
  | "failed";

export type TutorSessionMessage = {
  role: "user" | "assistant";
  content: string;
  /** Unix ms — what time this message was created. */
  ts: number;
};

export type TutorSessionUpload = {
  id: string;
  fileName: string;
  fileKind: "pdf" | "image" | "text" | "link";
  mimeType: string | null;
  sizeBytes: number | null;
  summary: string;
  createdAt: string;
  /** Present when the material was added as a URL. */
  sourceUrl?: string | null;
};

export type TutorSessionRecord = {
  id: string;
  title: string;
  topic: string;
  modeTag: TutorSessionModeTag | null;
  status: TutorSessionStatus;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  referenceSummary: string;
  discussionSummary: string;
  liveNotesJson: unknown;
  liveNotesText: string;
  recapMarkdown: string | null;
  recapGeneratedAt: string | null;
  recapStatus: TutorSessionRecapStatus;
  /**
   * Per-session "tell the AI how to write these notes" free text
   * (style/emphasis only). Optional so pre-migration rows degrade to "".
   */
  noteInstruction?: string;
  createdAt: string;
  updatedAt: string;
  /** Optional joined uploads. Set on detail fetches, omitted on list. */
  uploads?: TutorSessionUpload[];
  /** Optional joined transcript. Omitted on list to keep payload small. */
  transcript?: TutorSessionMessage[];
};

/** Lightweight row for the sessions library. */
export type TutorSessionSummary = {
  id: string;
  title: string;
  topic: string;
  modeTag: TutorSessionModeTag | null;
  status: TutorSessionStatus;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  recapStatus: TutorSessionRecapStatus;
  /** First few lines of recap markdown for the card preview. */
  recapPreview: string | null;
};
