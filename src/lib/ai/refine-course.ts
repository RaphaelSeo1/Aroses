import Anthropic from "@anthropic-ai/sdk";
import {
  APIConnectionError,
  APIError,
  RateLimitError,
} from "@anthropic-ai/sdk";
import type { CoursePayload } from "@/types/course";
import { parseCoursePayload, stripJsonFence } from "@/lib/ai/course-payload";
import {
  buildIntentPromptSection,
  compressCourseForRefineInput,
  type RefineIntent,
} from "@/lib/ai/refine-course-intent";

const REFINE_SYSTEM = `You are Rose, an expert course editor for the Aroses study platform. You revise structured course JSON generated from a student's uploaded materials.

You MUST apply the student's edit request and return a modified course. Never return the input unchanged unless the request is literally impossible.

Lesson "content" is Markdown (headings, lists, **bold**, inline math). Images use ![caption](url) or <img> tags.

Output ONLY one valid JSON object — no markdown fences, no commentary.`;

/**
 * Refine applies edits to an existing course JSON (not a cold build from PDF).
 * Default **Sonnet** for instruction-following on large JSON edits. Set
 * `ANTHROPIC_REFINE_MODEL=claude-haiku-4-5` if you prefer speed over fidelity.
 */
function resolveRefineModel(): string {
  const override = process.env.ANTHROPIC_REFINE_MODEL?.trim();
  if (override) return override;
  return "claude-sonnet-4-6";
}

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
    model: resolveRefineModel(),
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

function mergeUntouchedModules(
  original: CoursePayload,
  revised: CoursePayload,
  targetModuleIds: number[]
): CoursePayload {
  const targets = new Set(targetModuleIds);
  const revisedById = new Map(revised.modules.map((m) => [m.id, m]));

  return {
    title: typeof revised.title === "string" ? revised.title : original.title,
    description:
      typeof revised.description === "string"
        ? revised.description
        : original.description,
    modules: original.modules.map((origMod) => {
      if (!targets.has(origMod.id)) return origMod;
      return revisedById.get(origMod.id) ?? origMod;
    }),
  };
}

function buildRefineUserPrompt(
  original: CoursePayload,
  current: CoursePayload,
  instruction: string,
  intent: RefineIntent
): string {
  const intentSection = buildIntentPromptSection(intent);
  const serialized = JSON.stringify(current);
  const capped =
    serialized.length > 170_000
      ? serialized.slice(0, 170_000) +
        "\n…[truncated for model input; preserve structure and all modules in output]"
      : serialized;

  return `${intentSection}

CURRENT_COURSE_JSON:
${capped}

EDIT REQUEST FROM THE STUDENT:
${instruction.trim()}

Return the FULL revised course JSON with this schema:
- "title": string
- "description": string
- "modules": [{ "id", "title", "lessons": [{ "title", "content", "key_terms", "examples" }], "quiz": [ mcq | free_response items ] }]

Quiz MCQ: { "type":"mcq", "question", "choices":[4 strings], "correct", "explanation" }
Quiz free response: { "type":"free_response", "question", "reference_answer", "explanation" }

Critical:
- Finish every string; never truncate mid-JSON.
- When scope is one or more specific modules, still return ALL modules — but only change the scoped ones.
- Preserve module ids unless merging/splitting (then renumber 1..n).
- Keep ≥1 lesson per module unless explicitly told to remove content.`;
}

function payloadForModel(
  original: CoursePayload,
  intent: RefineIntent
): CoursePayload {
  if (
    intent.compressUntouchedModules &&
    intent.scope.kind === "modules"
  ) {
    return compressCourseForRefineInput(original, intent.scope.moduleIds);
  }
  return original;
}

function finalizeRefinedCourse(
  original: CoursePayload,
  revised: CoursePayload,
  intent: RefineIntent
): CoursePayload {
  if (intent.scope.kind === "modules") {
    return mergeUntouchedModules(original, revised, intent.scope.moduleIds);
  }
  return revised;
}

async function coursePayloadFromAssistantText(
  anthropic: Anthropic,
  rawText: string,
  stopReason?: string
): Promise<CoursePayload> {
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

export async function refineCourseWithInstruction(
  original: CoursePayload,
  instruction: string,
  intent: RefineIntent
): Promise<CoursePayload> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY");
  }

  const anthropic = new Anthropic({
    apiKey,
    timeout: 300_000,
    maxRetries: 0,
  });

  const modelInput = payloadForModel(original, intent);
  const userPrompt = buildRefineUserPrompt(
    original,
    modelInput,
    instruction,
    intent
  );

  const msg = await createMessageWithRetries(anthropic, {
    model: resolveRefineModel(),
    max_tokens: REFINE_MAX_OUTPUT_TOKENS,
    temperature: 0.15,
    system: REFINE_SYSTEM,
    messages: [{ role: "user", content: userPrompt }],
  });

  const rawText = extractTextBlock(msg);
  const stopReason = (msg as { stop_reason?: string }).stop_reason;
  const parsed = await coursePayloadFromAssistantText(
    anthropic,
    rawText,
    stopReason
  );
  return finalizeRefinedCourse(original, parsed, intent);
}

/**
 * Same model + prompt as {@link refineCourseWithInstruction}, but consumes a streaming
 * response so the connection stays alive on long generations (no raw token UI required).
 */
export async function refineCourseWithInstructionStreaming(
  original: CoursePayload,
  instruction: string,
  intent: RefineIntent
): Promise<CoursePayload> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY");
  }

  const anthropic = new Anthropic({
    apiKey,
    timeout: 300_000,
    maxRetries: 0,
  });

  const modelInput = payloadForModel(original, intent);
  const userPrompt = buildRefineUserPrompt(
    original,
    modelInput,
    instruction,
    intent
  );

  const stream = anthropic.messages.stream({
    model: resolveRefineModel(),
    max_tokens: REFINE_MAX_OUTPUT_TOKENS,
    temperature: 0.15,
    system: REFINE_SYSTEM,
    messages: [{ role: "user", content: userPrompt }],
  });

  for await (const evt of stream) {
    void evt;
  }

  const finalMessage = await stream.finalMessage();
  const rawText = extractTextBlock(finalMessage);
  const stopReason = (finalMessage as { stop_reason?: string }).stop_reason;
  const parsed = await coursePayloadFromAssistantText(
    anthropic,
    rawText,
    stopReason
  );
  return finalizeRefinedCourse(original, parsed, intent);
}
