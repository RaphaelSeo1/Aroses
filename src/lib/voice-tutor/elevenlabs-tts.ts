import { preprocessTtsText } from "./tts-pronunciation";

/**
 * ElevenLabs TTS wrapper. Conservative defaults — we explicitly tune the
 * voice so it sounds natural and reliable across long study sessions,
 * but we DO NOT do anything that risks the engine reading gibberish:
 *
 *   • `voice_settings` tuned for clarity (high stability, low style,
 *     speaker_boost on). Overridable via env so you can tweak the
 *     vibe without redeploying.
 *   • `apply_text_normalization` left at the API default. The "auto"
 *     setting we briefly tried caused the engine to inject random
 *     words mid-sentence, so we keep ElevenLabs' own behaviour.
 *   • Text preprocessing only fixes a tiny IPA whitelist on the `v3`
 *     model family (the only one that reliably honours `<phoneme>`).
 *     Other models receive your text untouched.
 *
 * Tunable env vars (all optional):
 *   ELEVENLABS_MODEL_ID          — default "eleven_flash_v2_5" (low-latency; override with
 *                                  "eleven_multilingual_v2" if you prefer maximum consistency)
 *   ELEVENLABS_STREAM_LATENCY     — optimize_streaming_latency 0–4 for `/stream` (default 4)
 *   ELEVENLABS_VOICE_STABILITY   — 0.0–1.0, default 0.65
 *   ELEVENLABS_VOICE_SIMILARITY  — 0.0–1.0, default 0.80
 *   ELEVENLABS_VOICE_STYLE       — 0.0–1.0, default 0.00 (neutral)
 *   ELEVENLABS_SPEAKER_BOOST     — "true"/"false", default true
 */
export const DEFAULT_ELEVENLABS_MODEL_ID = "eleven_flash_v2_5";

export async function synthesizeElevenLabs(params: {
  apiKey: string;
  voiceId: string;
  text: string;
  modelId: string;
  previousText?: string;
  nextText?: string;
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
        ...(params.previousText?.trim()
          ? { previous_text: params.previousText.trim().slice(-1500) }
          : {}),
        ...(params.nextText?.trim()
          ? { next_text: params.nextText.trim().slice(0, 1500) }
          : {}),
        voice_settings: voiceSettings,
      }),
    }
  );
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`ElevenLabs HTTP ${res.status}: ${t.slice(0, 240)}`);
  }
  return res.arrayBuffer();
}

/**
 * Low-latency streaming MP3 from ElevenLabs. Caller reads `response.body` or
 * forwards the Response to the client. Uses `output_format=mp3_44100_128` and
 * `optimize_streaming_latency` for earliest playable bytes.
 */
export async function streamElevenLabsTts(params: {
  apiKey: string;
  voiceId: string;
  text: string;
  modelId: string;
  optimizeStreamingLatency?: number;
  previousText?: string;
  nextText?: string;
}): Promise<Response> {
  const rawText = params.text.trim().slice(0, 4500);
  if (!rawText) {
    throw new Error("EMPTY_TTS_TEXT");
  }

  const text = preprocessTtsText(rawText, params.modelId);
  const voiceSettings = resolveVoiceSettings();

  const latency =
    typeof params.optimizeStreamingLatency === "number"
      ? Math.min(4, Math.max(0, Math.round(params.optimizeStreamingLatency)))
      : parseIntEnv("ELEVENLABS_STREAM_LATENCY", 2);

  const qs = new URLSearchParams({
    output_format: "mp3_44100_128",
    optimize_streaming_latency: String(latency),
  });

  return fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(params.voiceId)}/stream?${qs}`,
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
        ...(params.previousText?.trim()
          ? { previous_text: params.previousText.trim().slice(-1500) }
          : {}),
        ...(params.nextText?.trim()
          ? { next_text: params.nextText.trim().slice(0, 1500) }
          : {}),
        voice_settings: voiceSettings,
      }),
    }
  );
}

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return fallback;
  return n;
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
    // High stability = even, predictable delivery (less likely to flip
    // accents or mispronounce mid-sentence). Lower values are more
    // expressive but reintroduced the "random words" artifacts.
    stability: parseFloatEnv("ELEVENLABS_VOICE_STABILITY", 0.65),
    // Moderate similarity_boost — high enough to stay anchored to the
    // reference voice without forcing it to match too rigidly.
    similarity_boost: parseFloatEnv("ELEVENLABS_VOICE_SIMILARITY", 0.8),
    // Style 0 = absolutely neutral. Any style > 0 amplifies the
    // reference voice's stylistic quirks, which is exactly when the
    // pronunciation gets weird.
    style: parseFloatEnv("ELEVENLABS_VOICE_STYLE", 0),
    use_speaker_boost: parseBoolEnv("ELEVENLABS_SPEAKER_BOOST", true),
  };
}
