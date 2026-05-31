/** Error carrying the upstream OpenAI status + a sanitized provider message. */
export class WhisperError extends Error {
  status: number;
  provider: string;
  constructor(status: number, provider: string) {
    super(`Whisper HTTP ${status}: ${provider}`);
    this.name = "WhisperError";
    this.status = status;
    this.provider = provider;
  }
}

const TIMEOUT_MS = 60_000;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Whisper sniffs the upload's filename extension to pick a decoder, so it must
 * match the real audio container. Browsers vary: Chrome/Firefox record
 * webm/opus, but Safari/iOS record mp4/aac. Forwarding everything as
 * `speech.webm` made Safari recordings fail with a 400 "invalid file format".
 */
function filenameForAudioType(mime: string): string {
  const t = (mime || "").toLowerCase();
  if (t.includes("webm")) return "speech.webm";
  if (t.includes("ogg")) return "speech.ogg";
  if (t.includes("wav")) return "speech.wav";
  if (t.includes("mpeg") || t.includes("mp3")) return "speech.mp3";
  if (t.includes("mp4") || t.includes("m4a") || t.includes("aac"))
    return "speech.mp4";
  // Unknown: webm is the most common browser output, so it's the safest guess.
  return "speech.webm";
}

/** Pull a human reason out of OpenAI's error body without leaking anything sensitive. */
function parseProviderReason(raw: string): string {
  try {
    const j = JSON.parse(raw) as { error?: { message?: string } };
    if (j?.error?.message) return j.error.message.slice(0, 300);
  } catch {
    /* not JSON */
  }
  return raw.slice(0, 300);
}

export async function transcribeWithWhisper(params: {
  audio: Blob;
  apiKey: string;
  language?: string;
}): Promise<string> {
  const model = process.env.OPENAI_TRANSCRIBE_MODEL?.trim() || "whisper-1";
  const filename = filenameForAudioType(params.audio.type);

  // Up to two attempts: retry once on transient failures (429, 5xx, network,
  // timeout). Auth/format errors (401/403/400) fail fast — retrying won't help.
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const fd = new FormData();
    fd.append("file", params.audio, filename);
    fd.append("model", model);
    if (params.language) {
      fd.append("language", params.language);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${params.apiKey}` },
        body: fd,
        signal: controller.signal,
      });
      if (!res.ok) {
        const reason = parseProviderReason(await res.text());
        const err = new WhisperError(res.status, reason);
        const transient = res.status === 429 || res.status >= 500;
        if (transient && attempt === 0) {
          lastErr = err;
          await sleep(700);
          continue;
        }
        throw err;
      }
      const j = (await res.json()) as { text?: string };
      return typeof j.text === "string" ? j.text.trim() : "";
    } catch (e) {
      // Network blip or timeout (AbortError) — retry once. WhisperErrors that
      // reach here are non-transient (already re-thrown above), so bubble them.
      if (e instanceof WhisperError) throw e;
      if (attempt === 0) {
        lastErr = e;
        await sleep(700);
        continue;
      }
      throw e instanceof Error ? e : new Error("Whisper request failed");
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Whisper request failed");
}
