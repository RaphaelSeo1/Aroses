import { isBillingUiEnabled } from "@/lib/billing/feature-flag";
import {
  voiceCapReachedMessage,
  type LimitCopy,
} from "@/lib/billing/limit-messages";

/**
 * Shared contract for the voice-usage cap across server routes and the client.
 *
 * When a user has used their monthly voice allowance, voice routes respond with
 * HTTP 402 and a JSON body carrying `code: VOICE_CAP_CODE`. The client detects
 * this code and softly falls back to text mode (never a hard block).
 */
export const VOICE_CAP_CODE = "voice_cap_reached";

export function voiceCapMessage(copy?: LimitCopy): string {
  return voiceCapReachedMessage({ upgradeAvailable: isBillingUiEnabled() }, copy);
}

/** @deprecated Use voiceCapMessage() — kept for any external imports. */
export const VOICE_CAP_MESSAGE = voiceCapMessage();

/** Shared 402 JSON body for voice-cap responses, in the student's language. */
export function voiceCapBody(copy?: LimitCopy): { error: string; code: string } {
  return { error: voiceCapMessage(copy), code: VOICE_CAP_CODE };
}
