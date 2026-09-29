/**
 * Voice-mode Mentored Learning / tutor session turns are billed as voice
 * tutoring, not chat: Rose's reply is spoken through /api/voice-tutor/tts,
 * which records its seconds against the voice meter (`voice-usage.ts`).
 *
 * The runner's voice/text mode lives in the browser, so the client's
 * `voiceMode` flag alone isn't trusted. A turn skips the chat meter only when
 * voice is really being charged: the student still has voice time left (so
 * TTS won't 402 and drop them to text) and their voice meter was charged
 * within the last `VOICE_TURN_WINDOW_MS` (Rose spoke recently in this
 * session). Otherwise the turn counts as a normal chat message.
 */

/** Long enough for a student to think between turns; short enough to lapse soon after voice stops. */
export const VOICE_TURN_WINDOW_MS = 10 * 60 * 1000;

export type VoiceMeterSnapshot = {
  /** Voice seconds left this period (cap + bonus − used). */
  remainingSeconds: number;
  /** When voice seconds were last recorded this period; null if none yet. */
  lastChargedAt: string | null;
};

export function isChargedVoiceTurn(input: {
  voiceMode: boolean;
  meter: VoiceMeterSnapshot | null;
  now?: Date;
  windowMs?: number;
}): boolean {
  if (!input.voiceMode || !input.meter) return false;
  if (!(input.meter.remainingSeconds > 0)) return false;
  const charged = input.meter.lastChargedAt
    ? Date.parse(input.meter.lastChargedAt)
    : Number.NaN;
  if (!Number.isFinite(charged)) return false;
  const age = (input.now ?? new Date()).getTime() - charged;
  return age >= -60_000 && age <= (input.windowMs ?? VOICE_TURN_WINDOW_MS);
}

/**
 * Snapshot from a `voice_usage` row. A row from an older period means nothing
 * has been charged this period yet.
 */
export function voiceMeterSnapshot(input: {
  row: {
    period_start?: unknown;
    seconds_used?: unknown;
    bonus_seconds?: unknown;
    updated_at?: unknown;
  } | null;
  periodStartIso: string;
  capSeconds: number;
}): VoiceMeterSnapshot | null {
  const row = input.row;
  if (!row || typeof row.period_start !== "string") return null;
  if (Date.parse(row.period_start) < Date.parse(input.periodStartIso)) return null;
  const used = Number(row.seconds_used ?? 0);
  const bonus = Number(row.bonus_seconds ?? 0);
  if (!Number.isFinite(used) || used <= 0) return null;
  return {
    remainingSeconds: input.capSeconds + (Number.isFinite(bonus) ? bonus : 0) - used,
    lastChargedAt: typeof row.updated_at === "string" ? row.updated_at : null,
  };
}
