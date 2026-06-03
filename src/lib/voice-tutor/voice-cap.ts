import { isBillingUiEnabled } from "@/lib/billing/feature-flag";

/**
 * Shared contract for the voice-usage cap across server routes and the client.
 *
 * When a user has used their monthly voice allowance, voice routes respond with
 * HTTP 402 and a JSON body carrying `code: VOICE_CAP_CODE`. The client detects
 * this code and softly falls back to text mode (never a hard block).
 */
export const VOICE_CAP_CODE = "voice_cap_reached";

export function voiceCapMessage(): string {
  if (isBillingUiEnabled()) {
    return "You've used all your voice time for this billing period. Switched to text — upgrade your plan for more voice hours.";
  }
  return "You've used your voice allowance for this month. Switched to text — you can keep studying everything else.";
}

/** @deprecated Use voiceCapMessage() — kept for any external imports. */
export const VOICE_CAP_MESSAGE = voiceCapMessage();

/** Shared 402 JSON body for voice-cap responses. */
export function voiceCapBody(): { error: string; code: string } {
  return { error: voiceCapMessage(), code: VOICE_CAP_CODE };
}
