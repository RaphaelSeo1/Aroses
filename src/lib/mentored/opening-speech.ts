/**
 * Whether the fetched opening greeting may call TTS.
 *
 * The greeting request returns after the screen is already up. Continue
 * starts the concept narration immediately, and `speak()` always cancels
 * whatever is playing. The concept effect will not start that narration
 * again once it has claimed the chunk, so a late greeting must not speak.
 */
export function shouldSpeakFetchedGreeting(input: {
  voice: boolean;
  alreadyShown: boolean;
  teachingHasStarted: boolean;
}): boolean {
  if (!input.voice) return false;
  if (input.alreadyShown) return false;
  if (input.teachingHasStarted) return false;
  return true;
}
