/**
 * Resolves ElevenLabs `voice_id` for playback.
 *
 * Phase 1: `ELEVENLABS_VOICE_ID` only.
 * Phase 2 (voice cloning): load per-course clone from DB when present; otherwise env default.
 */
export function resolveTtsVoiceId(courseId: string | undefined): string {
  const fromEnv = process.env.ELEVENLABS_VOICE_ID?.trim();
  if (!fromEnv) {
    throw new Error("MISSING_ELEVENLABS_VOICE_ID");
  }
  void courseId;
  return fromEnv;
}
