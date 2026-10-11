import { createHash } from "node:crypto";
import {
  clipPrompt,
  illustrationPrompt,
  motionEditPrompt,
  motionStageBriefs,
} from "@/lib/mentored/board-illustration";

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

function imageModels(): string[] {
  const preferred = process.env.BOARD_IMAGE_MODEL?.trim();
  return [preferred, "gpt-image-2", "gpt-image-1", "gpt-image-1.5", "dall-e-3"].filter(
    (model, index, all): model is string =>
      Boolean(model) && all.indexOf(model) === index
  );
}

async function requestEdit(
  apiKey: string,
  model: string,
  prompt: string,
  source: string
): Promise<string> {
  const b64 = source.split(",")[1];
  if (!b64) throw new Error("Missing source picture.");
  const bytes = Buffer.from(b64, "base64");
  const form = new FormData();
  form.append("model", model);
  form.append("prompt", prompt);
  form.append("size", "1024x1024");
  form.append(
    "image",
    new Blob([new Uint8Array(bytes)], { type: "image/png" }),
    "board.png"
  );
  const response = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(90_000),
  });
  const payload = (await response.json()) as ImagePayload;
  if (!response.ok) {
    const message = payload.error?.message || `Image edit failed (${response.status})`;
    const error = new Error(message) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  const next = payload.data?.[0]?.b64_json;
  if (!next) throw new Error("Image edit had no picture.");
  return `data:image/png;base64,${next}`;
}

async function drawPrompt(apiKey: string, prompt: string): Promise<string> {
  const key = createHash("sha256").update(prompt).digest("hex");
  const hit = cache.get(key);
  if (hit) return hit;
  let last: Error | null = null;
  for (const model of imageModels()) {
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

/**
 * Three illustrated stages of one change. Later stages are edits of the
 * previous picture so the scene stays put and only the moving part shifts.
 */
export async function generateBoardAnimation(input: {
  title: string;
  brief: string;
  labels: string[];
  motion: string;
}): Promise<string[]> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set.");
  const stages = motionStageBriefs(input.brief, input.motion);
  const frames: string[] = [];
  frames.push(
    await drawPrompt(
      apiKey,
      illustrationPrompt({ title: input.title, brief: stages[0], labels: input.labels })
    )
  );
  const editStages = ["middle", "end"] as const;
  for (const stage of editStages) {
    const edit = motionEditPrompt(stage, input.motion);
    let next: string | null = null;
    for (const model of imageModels()) {
      if (!model.startsWith("gpt-image")) continue;
      try {
        next = await requestEdit(apiKey, model, edit, frames[frames.length - 1]);
        break;
      } catch (error) {
        const status = (error as { status?: number }).status;
        if (status && status !== 400 && status !== 404) break;
      }
    }
    frames.push(
      next ??
        (await drawPrompt(
          apiKey,
          illustrationPrompt({
            title: input.title,
            brief: `${input.brief} ${motionEditPrompt(stage, input.motion)}`,
            labels: input.labels,
          })
        ))
    );
  }
  return frames;
}

type VideoJob = {
  id?: string;
  status?: string;
  error?: { message?: string };
};

/**
 * A short teaching clip. Falls back to the caller when video generation
 * is unavailable; the route then plays the animation frames instead.
 */
export async function generateBoardClip(input: {
  title: string;
  brief: string;
  labels: string[];
  motion: string;
}): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set.");
  const prompt = clipPrompt(input);
  const key = createHash("sha256").update(`clip:${prompt}`).digest("hex");
  const hit = cache.get(key);
  if (hit) return hit;

  const preferred = process.env.BOARD_VIDEO_MODEL?.trim();
  const models = [preferred, "sora-2", "sora-2-pro"].filter(
    (model, index, all): model is string =>
      Boolean(model) && all.indexOf(model) === index
  );
  let last: Error | null = null;
  for (const model of models) {
    try {
      const video = await requestClip(apiKey, model, prompt);
      cacheSet(key, video);
      return video;
    } catch (error) {
      last = error instanceof Error ? error : new Error(String(error));
      const status = (error as { status?: number }).status;
      if (status && status !== 400 && status !== 404) break;
    }
  }
  throw last ?? new Error("Could not film the board.");
}

async function requestClip(
  apiKey: string,
  model: string,
  prompt: string
): Promise<string> {
  const created = await fetch("https://api.openai.com/v1/videos", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      prompt,
      seconds: "4",
      size: "1280x720",
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const job = (await created.json()) as VideoJob;
  if (!created.ok || !job.id) {
    const error = new Error(
      job.error?.message || `Video request failed (${created.status})`
    ) as Error & { status?: number };
    error.status = created.status;
    throw error;
  }

  const deadline = Date.now() + 100_000;
  let status = job.status ?? "queued";
  while (status !== "completed" && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const polled = await fetch(`https://api.openai.com/v1/videos/${job.id}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await polled.json()) as VideoJob;
    if (!polled.ok) {
      throw new Error(body.error?.message || `Video poll failed (${polled.status})`);
    }
    status = body.status ?? status;
    if (status === "failed") {
      throw new Error(body.error?.message || "Video generation failed.");
    }
  }
  if (status !== "completed") throw new Error("Video generation timed out.");

  const content = await fetch(`https://api.openai.com/v1/videos/${job.id}/content`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!content.ok) throw new Error(`Video download failed (${content.status})`);
  const bytes = Buffer.from(await content.arrayBuffer());
  if (bytes.length < 1000) throw new Error("Video file was empty.");
  return `data:video/mp4;base64,${bytes.toString("base64")}`;
}
