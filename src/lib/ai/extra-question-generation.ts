import { ANTHROPIC_HAIKU } from "./anthropic-models.ts";

/**
 * Shared settings for "generate more questions" (append-quiz) and "focus
 * questions". Both are metered per click, so they run on Haiku with a bounded
 * output budget.
 */

type Env = Record<string, string | undefined>;

/** Model for both question tools; `ANTHROPIC_EXTRA_QUESTIONS_MODEL` overrides. */
export function extraQuestionModel(env: Env = process.env): string {
  return env.ANTHROPIC_EXTRA_QUESTIONS_MODEL?.trim() || ANTHROPIC_HAIKU;
}

/** Output budget for one click's batch (8 questions is ~2–3.5k tokens). */
export const EXTRA_QUESTION_MAX_TOKENS = 4096;

/** Output budget for the single-question repair call. */
export const EXTRA_QUESTION_REPAIR_MAX_TOKENS = 1024;

/** Questions per "generate more questions" click (what the UI sends). */
export const APPEND_QUIZ_MAX_COUNT = 8;
const APPEND_QUIZ_MIN_COUNT = 4;

/** Server-side clamp for the request's `count`. */
export function clampAppendQuizCount(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return APPEND_QUIZ_MAX_COUNT;
  return Math.min(APPEND_QUIZ_MAX_COUNT, Math.max(APPEND_QUIZ_MIN_COUNT, Math.floor(raw)));
}
