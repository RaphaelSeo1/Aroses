/**
 * Shared Anthropic model ids so tutor conversation and chat Q&A cannot drift.
 *
 * Mentored / immersive turns use Haiku (`ANTHROPIC_TUTOR_FAST_MODEL`). Chat
 * surfaces (study, calendar Ask Rose, live lecture) share that same id —
 * cheaper than course generation, which stays on its own Sonnet/course models.
 *
 * Voice tutor *spoken* replies still use `tutorReplyModel()` (Sonnet unless
 * `ANTHROPIC_TUTOR_MODEL` is set). That override is for TTS-bound tutoring.
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
