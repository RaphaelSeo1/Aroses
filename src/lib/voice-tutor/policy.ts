/**
 * Material-access / feature-flag hook for the voice tutor (kept as a seam for
 * per-course or feature gating). It does NOT enforce the monthly voice cap —
 * that lives in `@/lib/billing/voice-usage` (`checkVoiceAllowance`) and is
 * applied directly in the voice routes (/tts, /transcribe, /deepgram-token) so
 * it covers every surface uniformly, including tutor sessions. A cap hit
 * returns HTTP 402 (see voice-cap.ts); access denials here return 403.
 */
export type VoiceTutorGate =
  | { allowed: true }
  | { allowed: false; reason: string };

export async function getVoiceTutorGate(opts: {
  userId: string;
  materialId: string;
  courseId?: string;
}): Promise<VoiceTutorGate> {
  void opts;
  return { allowed: true };
}
