import Anthropic from "@anthropic-ai/sdk";
import {
  APIConnectionError,
  APIError,
  RateLimitError,
} from "@anthropic-ai/sdk";
import { parseCoursePayload, stripJsonFence } from "@/lib/ai/course-payload";
import { getPdfAnthropicTimeoutMs } from "@/lib/pdf-route-duration";
import type { CoursePayload } from "@/types/course";

/**
 * Default **`fast`**: small enough JSON to usually finish under Vercel’s ~5m function cap.
 * Set `COURSE_BUILD_PROFILE=balanced` or `full` for richer courses (slower / more timeouts).
 */
type CourseBuildProfile = "full" | "balanced" | "fast";

function resolveCourseBuildProfile(): CourseBuildProfile {
  const p = process.env.COURSE_BUILD_PROFILE?.trim().toLowerCase();
  if (p === "full") return "full";
  if (p === "balanced") return "balanced";
  return "fast";
}

/**
 * Optional `ANTHROPIC_COURSE_MODEL` overrides everything.
 * `fast` defaults to Haiku so one job usually finishes inside the Vercel wall clock.
 */
function resolveCourseModel(profile: CourseBuildProfile): string {
  const override = process.env.ANTHROPIC_COURSE_MODEL?.trim();
  if (override) return override;
  if (profile === "fast") return "claude-3-5-haiku-20241022";
  return "claude-sonnet-4-6";
}

/** Rough input budget — large PDFs + long outputs often hit limits or timeouts. */
const MAX_MATERIAL_CHARS = 120_000;
const FAST_MATERIAL_CHARS = 72_000;

function truncateMaterial(text: string, maxChars: number = MAX_MATERIAL_CHARS): string {
  const t = text.trim();
  if (t.length <= maxChars) return t;
  const head = Math.floor(maxChars * 0.72);
  const tail = maxChars - head - 80;
  return `${t.slice(0, head)}\n\n[ … middle of document omitted for processing … ]\n\n${t.slice(-tail)}`;
}

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

function courseInstruction(
  materialText: string,
  profile: CourseBuildProfile
): string {
  let sizeRules: string;
  let quizFooter: string;

  if (profile === "full") {
    sizeRules = `Rules for output size (important): use at least 2 modules and at most 8 unless the source is extremely short. Keep each lesson "content" thorough but under roughly 1000 words so the full answer fits in one response. Every module must include at least one lesson.

QUIZ (critical): Each module needs a rich practice set — **at least 8 questions per module**, with **at least 4 items** whose type is free_response (short written answer). The rest should be mcq. Aim for roughly half MCQ and half free-response overall. MCQs must have exactly 4 choices. Every free_response **must** include **reference_answer** (snake_case, non-empty, several sentences of rubric — key ideas and acceptable points).`;
    quizFooter =
      "Include many quiz objects per module (minimum 8 total per module, including ≥4 free_response). Do not omit free_response types — they are required. Only return valid JSON. No markdown fences, no extra text. Base everything strictly on the uploaded material — do not add outside information.";
  } else if (profile === "fast") {
    sizeRules = `Rules for output size (important): use at least 2 modules and at most 5 unless the source is extremely short. Keep each lesson "content" clear and instructive but under roughly 550 words. Every module must include at least one lesson.

QUIZ (critical): Each module needs a practical practice set — **at least 5 questions per module**, with **at least 2 items** whose type is free_response (short written answer). The rest should be mcq. MCQs must have exactly 4 choices. Every free_response **must** include **reference_answer** (snake_case, non-empty, concise rubric).`;
    quizFooter =
      "Include enough quiz objects per module to meet the minimums above (≥5 per module, including ≥2 free_response). Do not omit free_response types — they are required. Only return valid JSON. No markdown fences, no extra text. Base everything strictly on the uploaded material — do not add outside information.";
  } else {
    sizeRules = `Rules for output size (important): use at least 2 modules and at most 6 unless the source is extremely short. Keep each lesson "content" thorough and instructive but under roughly 800 words so the response stays fast. Every module must include at least one lesson.

QUIZ (critical): Each module needs a strong practice set — **at least 6 questions per module**, with **at least 3 items** whose type is free_response (short written answer). The rest should be mcq. Aim for a solid mix of MCQ and free-response. MCQs must have exactly 4 choices. Every free_response **must** include **reference_answer** (snake_case, non-empty, clear rubric — key ideas and acceptable points).`;
    quizFooter =
      "Include enough quiz objects per module to meet the minimums above (≥6 per module, including ≥3 free_response). Do not omit free_response types — they are required. Only return valid JSON. No markdown fences, no extra text. Base everything strictly on the uploaded material — do not add outside information.";
  }

  return `You are an expert course designer and educator. You have been given raw course material (lecture slides, syllabi, notes). Your job is NOT to summarize this material. Your job is to use it as a source to BUILD a complete, professional, structured course that a student would genuinely pay for.

${sizeRules}

Generate the course in this exact JSON format:
{
  "title": "course title",
  "description": "compelling course description",
  "modules": [
    {
      "id": 1,
      "title": "module title",
      "lessons": [
        {
          "title": "lesson title",
          "content": "deep, thorough explanation written like a great teacher — not bullet points. Use analogies, real world examples, break it down simply",
          "key_terms": [{"term": "word", "definition": "definition"}],
          "examples": ["real world example 1", "real world example 2"]
        }
      ],
      "quiz": [
        {
          "type": "mcq",
          "question": "question text",
          "choices": ["A", "B", "C", "D"],
          "correct": "A",
          "explanation": "why this is correct and why the others are wrong"
        },
        {
          "type": "free_response",
          "question": "open-ended prompt requiring reasoning or recall",
          "reference_answer": "what a strong answer should cover — concepts, definitions, and acceptable variants",
          "explanation": "why those ideas matter and common misconceptions"
        }
      ]
    }
  ]
}
${quizFooter}

--- MATERIAL START ---
${materialText}
--- MATERIAL END ---`;
}

async function createMessageWithRetries(
  anthropic: Anthropic,
  params: Omit<Parameters<Anthropic["messages"]["create"]>[0], "stream"> & {
    stream?: false;
  },
  opts?: { maxAttempts?: number }
): Promise<Anthropic.Message> {
  let lastErr: unknown;
  const maxAttempts = opts?.maxAttempts ?? 5;
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
  const block = msg.content.find(
    (b): b is Anthropic.TextBlock => b.type === "text"
  );
  if (!block || block.type !== "text") {
    throw new Error("Unexpected response from Claude");
  }
  return block.text;
}

async function repairPayloadJson(
  anthropic: Anthropic,
  brokenAssistantText: string,
  profile: CourseBuildProfile
): Promise<CoursePayload> {
  const prompt = `You previously returned JSON that could not be parsed or validated. Output ONLY a single valid JSON object for the same course schema (title, description, modules with lessons and quiz arrays). Fix truncation, stray commas, or malformed strings. No markdown, no commentary.

Broken output (repair it):
${brokenAssistantText.slice(0, 120_000)}`;

  const msg = await createMessageWithRetries(
    anthropic,
    {
      model: resolveCourseModel(profile),
      max_tokens: profile === "fast" ? 16_384 : 32_768,
      temperature: 0.1,
      messages: [{ role: "user", content: prompt }],
    },
    { maxAttempts: profile === "fast" ? 2 : 4 }
  );

  const text = extractTextBlock(msg);
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFence(text));
  } catch {
    throw new Error("Claude did not return valid JSON after repair attempt");
  }
  return parseCoursePayload(parsed);
}

export async function generateCourseFromMaterial(
  materialText: string
): Promise<CoursePayload> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY");
  }

  const profile = resolveCourseBuildProfile();
  const anthropic = new Anthropic({
    apiKey,
    /** Stay under `/api/process-pdf` `maxDuration` (see `@/lib/pdf-route-duration`). */
    timeout: getPdfAnthropicTimeoutMs(),
    maxRetries: 0,
  });

  const trimmed = truncateMaterial(
    materialText,
    profile === "fast" ? FAST_MATERIAL_CHARS : MAX_MATERIAL_CHARS
  );
  const instruction = courseInstruction(trimmed, profile);

  const msg = await createMessageWithRetries(
    anthropic,
    {
      model: resolveCourseModel(profile),
      max_tokens: profile === "fast" ? 18_432 : 32_768,
      temperature: 0.2,
      messages: [{ role: "user", content: instruction }],
    },
    { maxAttempts: profile === "fast" ? 2 : 5 }
  );

  const rawText = extractTextBlock(msg);
  const stopReason = (msg as { stop_reason?: string }).stop_reason;
  if (stopReason === "max_tokens") {
    console.warn(
      "[study-generation] Claude hit max_tokens; attempting JSON repair"
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFence(rawText));
  } catch {
    try {
      return await repairPayloadJson(anthropic, rawText, profile);
    } catch (e) {
      console.error(e);
      throw new Error("Claude did not return valid JSON");
    }
  }

  try {
    return parseCoursePayload(parsed);
  } catch (e) {
    console.warn("[study-generation] Payload validation failed; repairing", e);
    try {
      return await repairPayloadJson(anthropic, rawText, profile);
    } catch {
      throw e;
    }
  }
}
