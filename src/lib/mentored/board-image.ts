import { createHash } from "node:crypto";
import { illustrationPrompt } from "@/lib/mentored/board-illustration";

const cache = new Map<string, string>();
const CACHE_MAX = 24;

type ImagePayload = {
  data?: Array<{ b64_json?: string; url?: string }>;
  error?: { message?: string };
};

function cacheSet(key: string, value: string) {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
}

async function requestImage(
  apiKey: string,
  model: string,
  prompt: string
): Promise<string> {
  const body: Record<string, unknown> = {
    model,
    prompt,
    n: 1,
    size: "1024x1024",
  };
  if (model.startsWith("gpt-image")) body.quality = "medium";
  else body.response_format = "b64_json";

  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
  const payload = (await response.json()) as ImagePayload;
  if (!response.ok) {
    const message = payload.error?.message || `Image request failed (${response.status})`;
    const error = new Error(message) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  const b64 = payload.data?.[0]?.b64_json;
  if (!b64) throw new Error("Image response had no picture.");
  return `data:image/png;base64,${b64}`;
}

/**
 * One illustrated teaching board for a lesson chunk.
 * Tries the configured model, then the current OpenAI image models.
 */
export async function generateBoardIllustration(input: {
  title: string;
  brief: string;
  labels: string[];
}): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set.");

  const prompt = illustrationPrompt(input);
  const key = createHash("sha256").update(prompt).digest("hex");
  const hit = cache.get(key);
  if (hit) return hit;

  const preferred = process.env.BOARD_IMAGE_MODEL?.trim();
  const models = [
    preferred,
    "gpt-image-1",
    "gpt-image-1.5",
    "dall-e-3",
  ].filter((model, index, all): model is string =>
    Boolean(model) && all.indexOf(model) === index
  );

  let last: Error | null = null;
  for (const model of models) {
    try {
      const image = await requestImage(apiKey, model, prompt);
      cacheSet(key, image);
      return image;
    } catch (error) {
      last = error instanceof Error ? error : new Error(String(error));
      const status = (error as { status?: number }).status;
      if (status && status !== 400 && status !== 404) break;
    }
  }
  throw last ?? new Error("Could not draw the board.");
}
