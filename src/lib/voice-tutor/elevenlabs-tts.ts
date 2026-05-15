import { preprocessTtsText } from "./tts-pronunciation";

/**
 * ElevenLabs TTS wrapper. Pronunciation accuracy improvements bundled in:
 *
 *   • `voice_settings` tuned for clear enunciation (lower style, higher
 *     similarity_boost, speaker_boost on). Override via env if a course
 *     needs a different vibe.
 *   • `apply_text_normalization` = "auto" so numbers, currencies, dates,
 *     and abbreviations are expanded before synthesis.
 *   • Text preprocessing pass that rewrites known scientific/technical
 *     terms (Coulomb, ionic, mitochondria, kubernetes, etc.) into either
 *     IPA phoneme tags (v3 / multilingual models) or plain phonetic
 *     spellings (turbo / english models). See `tts-pronunciation.ts`.
 *
 * Tunable env vars (all optional):
 *   ELEVENLABS_MODEL_ID          — default "eleven_turbo_v2_5"
 *   ELEVENLABS_VOICE_STABILITY   — 0.0–1.0, default 0.45
 *   ELEVENLABS_VOICE_SIMILARITY  — 0.0–1.0, default 0.85
 *   ELEVENLABS_VOICE_STYLE       — 0.0–1.0, default 0.10 (low = neutral)
 *   ELEVENLABS_SPEAKER_BOOST     — "true"/"false", default true
 */
export async function synthesizeElevenLabs(params: {
  apiKey: string;
  voiceId: string;
  text: string;
  modelId: string;
}): Promise<ArrayBuffer> {
  const rawText = params.text.trim().slice(0, 4500);
  if (!rawText) {
    throw new Error("EMPTY_TTS_TEXT");
  }

  const text = preprocessTtsText(rawText, params.modelId);
  const voiceSettings = resolveVoiceSettings();

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(params.voiceId)}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": params.apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        model_id: params.modelId,
        text,
        voice_settings: voiceSettings,
        // Lets ElevenLabs expand numbers, currency, dates, ordinals, and
        // common abbreviations to their spoken form before synthesis.
        apply_text_normalization: "auto",
      }),
    }
  );
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`ElevenLabs HTTP ${res.status}: ${t.slice(0, 240)}`);
  }
  return res.arrayBuffer();
}

function parseFloatEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseFloat(raw);
  if (Number.isNaN(n)) return fallback;
  return Math.min(1, Math.max(0, n));
}

function parseBoolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.toLowerCase().trim();
  if (!raw) return fallback;
  return raw === "true" || raw === "1" || raw === "yes";
}

function resolveVoiceSettings() {
  return {
    // Lower stability = more expressive but slightly less consistent;
    // 0.45 lands in the "clear, lively, still reliable" zone.
    stability: parseFloatEnv("ELEVENLABS_VOICE_STABILITY", 0.45),
    // High similarity_boost keeps the synthesized voice anchored to the
    // reference, which usually improves enunciation of unfamiliar words.
    similarity_boost: parseFloatEnv("ELEVENLABS_VOICE_SIMILARITY", 0.85),
    // Low style = neutral delivery. Higher values exaggerate the
    // reference voice's quirks, which can break technical pronunciation.
    style: parseFloatEnv("ELEVENLABS_VOICE_STYLE", 0.1),
    use_speaker_boost: parseBoolEnv("ELEVENLABS_SPEAKER_BOOST", true),
  };
}
