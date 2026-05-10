import Anthropic from "@anthropic-ai/sdk";
import {
  APIConnectionError,
  APIError,
  RateLimitError,
} from "@anthropic-ai/sdk";
import type { CoursePayload } from "@/types/course";
import { parseCoursePayload, stripJsonFence } from "@/lib/ai/course-payload";

const MODEL = "claude-sonnet-4-20250514";

/** Large courses need plenty of headroom for full JSON round-trip. */
const REFINE_MAX_OUTPUT_TOKENS = 64_000;

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

function isRetryableApiError(err: unknown): boolean {
  if (err instanceof RateLimitError) return true;
  if (err instanceof APIConnectionError) return true;
  if (err instanceof APIError && typeof err.status === "number") {
    const s = err.status;
    return [408, 429, 500, 502, 503, 529].includes(s);
  }
  return false;
}

async function createMessageWithRetries(
  anthropic: Anthropic,
  params: Omit<Parameters<Anthropic["messages"]["create"]>[0], "stream"> & {
    stream?: false;
  }
): Promise<Anthropic.Message> {
  let lastErr: unknown;
  const maxAttempts = 5;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await anthropic.messages.create({ ...params, stream: false });
    } catch (err) {
      lastErr = err;
      const retry = isRetryableApiError(err) && attempt < maxAttempts - 1;
      if (!retry) throw err;
      const delay = Math.min(
        45_000,
        1200 * 2 ** attempt + Math.floor(Math.random() * 600)
      );
      await sleep(delay);
    }
  }
  throw lastErr;
}

function extractTextBlock(msg: Anthropic.Message): string {
  const block = msg.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") {
    throw new Error("Unexpected response from Claude");
  }
  return block.text;
}

async function repairRefinedCourseJson(
  anthropic: Anthropic,
  brokenAssistantText: string
): Promise<CoursePayload> {
  const prompt = `You previously returned JSON that could not be parsed or validated. Output ONLY one valid JSON object for the course schema:
title (string), description (string), modules: [{ id, title, lessons: [{ title, content, key_terms, examples }], quiz: [ mcq and free_response items ] }].
Fix truncation at the end, stray commas, unclosed brackets/strings, and malformed escapes. Preserve as much content as possible but the output MUST be complete valid JSON.

Broken output (repair it completely):
${brokenAssistantText.slice(0, 140_000)}`;

  const msg = await createMessageWithRetries(anthropic, {
    model: MODEL,
    max_tokens: REFINE_MAX_OUTPUT_TOKENS,
    temperature: 0.05,
    messages: [{ role: "user", content: prompt }],
  });

  const text = extractTextBlock(msg);
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFence(text));
  } catch {
    throw new Error("REFINE_REPAIR_JSON_PARSE");
  }
  return parseCoursePayload(parsed);
}

export async function refineCourseWithInstruction(
  current: CoursePayload,
  instruction: string
): Promise<CoursePayload> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY");
  }

  const serialized = JSON.stringify(current);
  const capped =
    serialized.length > 170_000
      ? serialized.slice(0, 170_000) +
        "\n…[truncated for model input; preserve structure and all modules in output]"
      : serialized;

  const userPrompt = `You are revising a structured course JSON object that was generated from the student's uploaded materials.

CURRENT_COURSE_JSON:
${capped}

EDIT REQUEST FROM THE STUDENT:
${instruction.trim()}

Your task:
- Return the FULL revised course as one JSON object using the SAME schema as the input:
  - "title": string
  - "description": string
  - "modules": array of objects with:
      "id": number,
      "title": string,
      "lessons": [ { "title", "content", "key_terms": [{"term","definition"}], "examples": [strings] } ],
      "quiz": [
        { "type": "mcq", "question", "choices": [4 strings], "correct", "explanation" },
        { "type": "free_response", "question", "reference_answer", "explanation" }
      ]

Critical:
- Your reply MUST be a single complete JSON object only — finish every string and close every bracket. If the course is large, keep edits concise but NEVER truncate mid-JSON.

Rules:
- Apply the edit request: remove tangents, tighten focus, fix awkward or incorrect parts, shorten verbose sections if asked, merge redundant lessons if needed.
- Stay aligned with topics and facts already in the course.
- Keep at least one lesson per module and a substantial quiz set when possible.
- Preserve module ids when possible; renumber only if you split or merge modules (consecutive from 1).

Output ONLY valid JSON. No markdown fences. No commentary before or after the JSON.`;

  const anthropic = new Anthropic({
    apiKey,
    timeout: 300_000,
    maxRetries: 0,
  });

  const msg = await createMessageWithRetries(anthropic, {
    model: MODEL,
    max_tokens: REFINE_MAX_OUTPUT_TOKENS,
    temperature: 0.15,
    messages: [{ role: "user", content: userPrompt }],
  });

  const rawText = extractTextBlock(msg);
  const stopReason = (msg as { stop_reason?: string }).stop_reason;
  if (stopReason === "max_tokens") {
    console.warn("[refine-course] Claude hit max_tokens; attempting repair");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFence(rawText));
  } catch {
    try {
      return await repairRefinedCourseJson(anthropic, rawText);
    } catch {
      throw new Error("REFINE_JSON_PARSE");
    }
  }

  try {
    return parseCoursePayload(parsed);
  } catch (e) {
    console.warn("[refine-course] Payload validation failed; repairing", e);
    try {
      return await repairRefinedCourseJson(anthropic, rawText);
    } catch {
      throw e;
    }
  }
}
