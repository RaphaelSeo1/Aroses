/**
 * Shared Anthropic model ids so tutor conversation and chat Q&A cannot drift.
 *
 * Chat surfaces (study, calendar Ask Rose, live lecture, review) and short
 * mentored turns share `tutorChatModel()` — Claude Sonnet 4.6 unless
 * `ANTHROPIC_TUTOR_FAST_MODEL` is set. Focus questions use Sonnet on their
 * own. Module quiz backfill and "generate more questions" stay on Haiku.
 *
 * Voice tutor *spoken* replies still use `tutorReplyModel()` (same Sonnet
 * default unless `ANTHROPIC_TUTOR_MODEL` is set). That override is for
 * TTS-bound tutoring.
 */

export const ANTHROPIC_HAIKU = "claude-haiku-4-5";
export const ANTHROPIC_SONNET = "claude-sonnet-4-6";

/** Conversational tutor + chat Q&A. Mentored turns, study/calendar/lecture chat. */
export function tutorChatModel(): string {
  return process.env.ANTHROPIC_TUTOR_FAST_MODEL?.trim() || ANTHROPIC_SONNET;
}

/** Voice tutor spoken replies and tutor notes/recap. */
export function tutorReplyModel(): string {
  return process.env.ANTHROPIC_TUTOR_MODEL?.trim() || ANTHROPIC_SONNET;
}
