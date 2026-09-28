import https from "node:https";
import { StepFatalError } from "./errors.ts";

const DEEPGRAM_TIMEOUT_MS = 240_000;

type DeepgramResponse = {
  metadata?: { duration?: number };
  results?: {
    channels?: Array<{
      alternatives?: Array<{ transcript?: string; paragraphs?: { transcript?: string } }>;
    }>;
  };
};

function deepgramKey(): string {
  let key = process.env.DEEPGRAM_API_KEY?.trim() ?? "";
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1).trim();
  }
  return key.replace(/^(token|bearer)\s+/i, "").trim();
}

/** IPv4 https: undici fetch can hang for ~40s on api.deepgram.com on some networks. */
function post(path: string, key: string, body: string): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.deepgram.com",
        path,
        method: "POST",
        family: 4,
        timeout: DEEPGRAM_TIMEOUT_MS,
        headers: {
          Authorization: `Token ${key}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          Accept: "application/json",
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c as Buffer));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }));
      }
    );
    req.on("timeout", () => req.destroy(new Error("Deepgram transcription timed out")));
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

/**
 * Prerecorded transcription of a file Deepgram can fetch (a signed storage
 * URL). Returns paragraph-formatted text.
 */
export async function transcribeMediaUrl(url: string, label: string): Promise<string> {
  const key = deepgramKey();
  if (!key) {
    throw new StepFatalError("transcription_unavailable", "Audio and video transcription isn't set up yet. Upload slides or a transcript instead.");
  }
  const params = new URLSearchParams({
    model: "nova-3",
    smart_format: "true",
    paragraphs: "true",
    detect_language: "true",
  });
  const res = await post(`/v1/listen?${params}`, key, JSON.stringify({ url }));
  if (res.status >= 500 || res.status === 429) {
    throw new Error(`Deepgram ${res.status}: ${res.text.slice(0, 200)}`);
  }
  if (res.status >= 400) {
    throw new StepFatalError(
      "file_unreadable",
      `We couldn't transcribe ${label}. Make sure it's a normal audio or video file with speech in it.`
    );
  }
  let parsed: DeepgramResponse;
  try {
    parsed = JSON.parse(res.text) as DeepgramResponse;
  } catch {
    throw new Error("Deepgram returned an unreadable response");
  }
  const alt = parsed.results?.channels?.[0]?.alternatives?.[0];
  const text = (alt?.paragraphs?.transcript || alt?.transcript || "").trim();
  if (!text) {
    throw new StepFatalError("no_speech", `We couldn't hear any speech in ${label}.`);
  }
  return text;
}
