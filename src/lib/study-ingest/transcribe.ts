import { MAX_WHISPER_BYTES } from "@/lib/study-ingest/formats";

export type TranscriptSegment = {
  startSec: number;
  endSec: number;
  text: string;
};

export type TranscriptionResult = {
  text: string;
  segments: TranscriptSegment[];
};

function formatTimestamp(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function transcriptWithTimestamps(result: TranscriptionResult): string {
  if (result.segments.length > 0) {
    return result.segments
      .map(
        (seg) =>
          `[${formatTimestamp(seg.startSec)}] ${seg.text.trim()}`
      )
      .join("\n");
  }
  return result.text.trim();
}

/**
 * Speech-to-text via OpenAI Whisper. Requires OPENAI_API_KEY.
 * Whisper accepts many audio/video formats up to 25MB.
 */
export async function transcribeMediaBuffer(
  buffer: Buffer,
  fileName: string
): Promise<TranscriptionResult> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "Audio and video transcription is not configured on this server (missing OPENAI_API_KEY). Upload a PDF or slides instead, or add your OpenAI key for transcription."
    );
  }

  if (buffer.length > MAX_WHISPER_BYTES) {
    const mb = Math.round(buffer.length / (1024 * 1024));
    throw new Error(
      `This recording is too large for automatic transcription (${mb}MB). The limit is 25MB per file for transcription — try compressing the video, trimming it, or uploading an MP3 of the audio only.`
    );
  }

  const form = new FormData();
  const blob = new Blob([new Uint8Array(buffer)]);
  form.append("file", blob, fileName);
  form.append("model", "whisper-1");
  form.append("response_format", "verbose_json");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  const raw = await res.text();
  if (!res.ok) {
    console.error("[transcribe] whisper error", res.status, raw.slice(0, 500));
    throw new Error(
      "Transcription failed. The recording might be too quiet, unclear, or in an unsupported format. Try uploading slides or a PDF instead."
    );
  }

  let parsed: {
    text?: string;
    segments?: Array<{ start?: number; end?: number; text?: string }>;
  };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    return { text: raw.trim(), segments: [] };
  }

  const text = (parsed.text ?? "").trim();
  const segments: TranscriptSegment[] = Array.isArray(parsed.segments)
    ? parsed.segments
        .map((s) => ({
          startSec: typeof s.start === "number" ? s.start : 0,
          endSec: typeof s.end === "number" ? s.end : 0,
          text: typeof s.text === "string" ? s.text : "",
        }))
        .filter((s) => s.text.trim().length > 0)
    : [];

  if (text.length < 40 && segments.length === 0) {
    throw new Error(
      "Not enough speech was detected in this file. Try a clearer recording or upload written materials instead."
    );
  }

  return { text, segments };
}
