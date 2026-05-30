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

function normalizeForCompare(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True when Whisper likely picked up Rose's own TTS (speaker bleed)
 * rather than the student speaking.
 */
export function isEchoOfAssistantSpeech(
  text: string,
  recentAssistant: string
): boolean {
  const t = normalizeForCompare(text);
  const assistant = normalizeForCompare(recentAssistant);
  if (!t || !assistant || t.length < 8) return false;

  if (assistant.includes(t) && t.length >= 16) return true;
  if (t.includes(assistant.slice(0, Math.min(assistant.length, 80)))) {
    return true;
  }

  const tWords = t.split(" ").filter((w) => w.length > 3);
  if (tWords.length === 0) return false;
  const aWords = new Set(assistant.split(" ").filter((w) => w.length > 3));
  let overlap = 0;
  for (const w of tWords) {
    if (aWords.has(w)) overlap += 1;
  }
  return overlap / tWords.length >= 0.55;
}
