/**
 * Shared contract for the voice-usage cap across server routes and the client.
 *
 * When a user has used their monthly voice allowance, voice routes respond with
 * HTTP 402 and a JSON body carrying `code: VOICE_CAP_CODE`. The client detects
 * this code and softly falls back to text mode (never a hard block).
 */
export const VOICE_CAP_CODE = "voice_cap_reached";

export const VOICE_CAP_MESSAGE =
  "You've used all your voice time for this billing period. Switched to text — upgrade your plan for more voice hours.";

/** Shared 402 JSON body for voice-cap responses. */
export function voiceCapBody(): { error: string; code: string } {
  return { error: VOICE_CAP_MESSAGE, code: VOICE_CAP_CODE };
}
