/**
 * Heuristic filter for Whisper output on coughs, room noise, or
 * near-silent captures. Used to avoid treating false barge-ins as
 * real student turns — callers resume TTS instead.
 */
export function isLikelyNoiseTranscript(text: string): boolean {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length < 3) return true;

  const lower = t.toLowerCase().replace(/[.!?,…]+$/g, "");
  const noiseExact = new Set([
    "uh",
    "um",
    "hmm",
    "hm",
    "ah",
    "oh",
    "mm",
    "mhm",
    "huh",
    "you",
    "thanks",
    "thank you",
    "okay",
    "ok",
    "yeah",
    "yea",
    "silence",
    "noise",
    "cough",
    "[silence]",
    "[noise]",
  ]);
  if (noiseExact.has(lower)) return true;
  if (t.length <= 8 && /^[^a-zA-Z0-9]*$/.test(t)) return true;
  if (/^(.)\1{3,}$/.test(lower.replace(/\s/g, ""))) return true;
  return false;
}
