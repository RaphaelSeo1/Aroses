/**
 * Shared Anthropic model ids so tutor conversation and chat Q&A cannot drift.
 *
 * Mentored / immersive text turns and chat surfaces (study, calendar Ask Rose,
 * live lecture, review) share `tutorChatModel()` — Claude Haiku 4.5 unless
 * `ANTHROPIC_TUTOR_FAST_MODEL` is set. Text tutoring stays on Haiku so a
 * maxed plan does not burn Sonnet on every chat turn.
 *
 * Voice tutor *spoken* replies still use `tutorReplyModel()` (same Sonnet
 * default unless `ANTHROPIC_TUTOR_MODEL` is set). That override is for
 * TTS-bound tutoring.
 */

export const ANTHROPIC_HAIKU = "claude-haiku-4-5";
export const ANTHROPIC_SONNET = "claude-sonnet-4-6";

/** Conversational tutor + chat Q&A. Mentored turns, study/calendar/lecture chat. */
export function tutorChatModel(): string {
  return process.env.ANTHROPIC_TUTOR_FAST_MODEL?.trim() || ANTHROPIC_HAIKU;
}

/** Voice tutor spoken replies and tutor notes/recap. */
export function tutorReplyModel(): string {
  return process.env.ANTHROPIC_TUTOR_MODEL?.trim() || ANTHROPIC_SONNET;
}
