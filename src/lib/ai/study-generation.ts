import Anthropic from "@anthropic-ai/sdk";
import {
  APIConnectionError,
  APIError,
  RateLimitError,
} from "@anthropic-ai/sdk";
import {
  type CourseOutlinePayload,
  type CourseStructurePlan,
  parseCourseModule,
  parseCourseOutlinePayload,
  parseCoursePayload,
  parseCourseStructurePlan,
  stripJsonFence,
} from "@/lib/ai/course-payload";
import type {
  IngestChunk,
  IngestChunkSummary,
} from "@/lib/study-ingest/chunking";
import { getPdfAnthropicTimeoutMs } from "@/lib/pdf-route-duration";
import { acquireClaudeBudget } from "@/lib/ai/anthropic-rate-limit";
import type { CourseModule, CoursePayload } from "@/types/course";

/**
 * Outline / structure-plan calls wait only briefly for global Claude budget so
 * the "planning" phase isn't starved by concurrent module writing (which holds
 * the bulk of the per-minute token budget). These calls are tiny, so a short
 * overshoot is safe and the reactive 429 backoff backstops it.
 */
const OUTLINE_BUDGET_WAIT_MS = 6_000;

export type { CourseOutlinePayload } from "@/lib/ai/course-payload";

/**
 * PDF ingest uses a **chunked** pipeline (outline in `runPdfIngestJob`, then one module per
 * `POST /api/process-pdf/expand`) so each invocation stays within the serverless wall clock.
 *
 * **Default `express`**: Haiku, tight caps — targets **~2–5 minutes** for a typical lecture PDF
 * (network + model latency vary; huge decks may exceed). Use `COURSE_BUILD_PROFILE=fast`,
 * `balanced`, or `full` for richer, slower output. `balanced` defaults are tuned to stay a bit
 * richer than `fast` without the old “~2× wall-clock” gap (see module/outline retries and caps).
 * `ANTHROPIC_COURSE_MODEL` overrides models.
 */
type CourseBuildProfile = "express" | "fast" | "balanced" | "full";

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function resolveCourseBuildProfile(): CourseBuildProfile {
  const p = process.env.COURSE_BUILD_PROFILE?.trim().toLowerCase();
  if (p === "full") return "full";
  if (p === "balanced") return "balanced";
  if (p === "fast") return "fast";
  if (p === "express") return "express";
  return "express";
}

/** Same truncation as outline/module generation — store on the job for expand steps. */
export function materialTextForPdfIngest(fullText: string): string {
  const profile = resolveCourseBuildProfile();
  const compact = fullText
    .trim()
    .replace(/[\u00a0\u200b\uFEFF]/g, "")
    .replace(/\n{6,}/g, "\n\n\n\n\n");
  return truncateMaterial(compact, materialCharLimit(profile));
}

const DIGEST_CHUNK_CHARS = 22_000;
const MAX_DIGEST_CHUNKS = 40;

/**
 * Turn full extracted PDF text into a single string that fits `materialCharLimit`.
 * Short inputs return truncated raw text (no extra model calls). Long inputs are
 * chunked and summarized so later outline/module steps can use the whole deck.
 */
export async function buildMaterialDigestFromFullPdfText(
  fullText: string,
  options?: { studyContext?: string; onChunkDone?: () => void | Promise<void> }
): Promise<string> {
  const profile = resolveCourseBuildProfile();
  const compact = fullText
    .trim()
    .replace(/[\u00a0\u200b\uFEFF]/g, "")
    .replace(/\n{6,}/g, "\n\n\n\n\n");

  const cap = materialCharLimit(profile);
  if (compact.length <= cap) {
    return truncateMaterial(compact, cap);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return materialTextForPdfIngest(compact);
  }

  const anthropic = new Anthropic({
    apiKey,
    timeout: getPdfAnthropicTimeoutMs(),
    maxRetries: 0,
  });
  const model = resolveOutlineModel(profile);
  const studySnippet =
    typeof options?.studyContext === "string" && options.studyContext.trim().length > 0
      ? options.studyContext.trim().slice(0, 2_500)
      : "";

  const chunks: string[] = [];
  for (
    let i = 0;
    i < compact.length && chunks.length < MAX_DIGEST_CHUNKS;
    i += DIGEST_CHUNK_CHARS
  ) {
    chunks.push(compact.slice(i, i + DIGEST_CHUNK_CHARS));
  }

  const summaries: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!;
    const prompt = `You are compressing slice ${i + 1} of ${chunks.length} from a long PDF transcript into dense study notes. Another step will turn the merged digest into a course.

RULES:
- Preserve **facts**: definitions, formulas, theorems, numbered steps, dates, names, terminology.
- Preserve **structure hints**: chapter/section titles visible in this slice.
- No JSON, no roleplay.

${studySnippet ? `Learner context (optional emphasis):\n${studySnippet}\n\n` : ""}--- SLICE ${i + 1}/${chunks.length} ---
${chunk}`;

    const digestMax =
      profile === "express"
        ? 3072
        : profile === "fast"
          ? 4096
          : profile === "balanced"
            ? 4096
            : 6144;

    const msg = await createMessageWithRetries(
      anthropic,
      {
        model,
        max_tokens: digestMax,
        temperature: 0.12,
        messages: [{ role: "user", content: prompt }],
      },
      {
        maxAttempts:
          profile === "express"
            ? 1
            : profile === "fast"
              ? 2
              : profile === "balanced"
                ? 2
                : 3,
      }
    );
    summaries.push(extractTextBlock(msg));
    await options?.onChunkDone?.();
  }

  const merged = `=== FULL DOCUMENT DIGEST (${chunks.length} slices) ===\n\n${summaries.join("\n\n---\n\n")}`;
  return truncateMaterial(merged, cap);
}

/**
 * Optional `ANTHROPIC_COURSE_MODEL` overrides everything.
 * `fast` defaults to **Claude Haiku 4.5** (3.5 Haiku IDs are removed from the API — 404).
 */
function resolveCourseModel(profile: CourseBuildProfile): string {
  const override = process.env.ANTHROPIC_COURSE_MODEL?.trim();
  if (override) return override;
  if (profile === "express" || profile === "fast" || profile === "balanced") {
    return "claude-haiku-4-5";
  }
  return "claude-sonnet-4-6";
}

/**
 * Compact outline JSON — **`express`**, **`fast`**, and **`balanced`** use Haiku for the outline
 * when neither `ANTHROPIC_OUTLINE_MODEL` nor `ANTHROPIC_COURSE_MODEL` is set.
 */
function resolveOutlineModel(profile: CourseBuildProfile): string {
  const outlineOnly = process.env.ANTHROPIC_OUTLINE_MODEL?.trim();
  if (outlineOnly) return outlineOnly;
  const courseOverride = process.env.ANTHROPIC_COURSE_MODEL?.trim();
  if (courseOverride) return courseOverride;
  if (profile === "express" || profile === "fast" || profile === "balanced") {
    return "claude-haiku-4-5";
  }
  return "claude-sonnet-4-6";
}

/** Rough input budget — large PDFs + long outputs often hit limits or timeouts. */
const MAX_MATERIAL_CHARS = 120_000;
/** Aggressively small for `fast` so outline/module calls stay quick. */
const FAST_MATERIAL_CHARS = 40_000;
/** `balanced`: default input budget; override with `COURSE_BALANCED_MATERIAL_CHARS`. */
const BALANCED_MATERIAL_CHARS = 36_000;

function materialCharLimit(profile: CourseBuildProfile): number {
  if (profile === "express") {
    return clampInt(envInt("COURSE_EXPRESS_MATERIAL_CHARS", 18_000), 10_000, 40_000);
  }
  if (profile === "fast") {
    const fromEnv = envInt("COURSE_FAST_MATERIAL_CHARS", FAST_MATERIAL_CHARS);
    return clampInt(fromEnv, 8_000, MAX_MATERIAL_CHARS);
  }
  if (profile === "balanced") {
    const fromEnv = envInt(
      "COURSE_BALANCED_MATERIAL_CHARS",
      BALANCED_MATERIAL_CHARS
    );
    return clampInt(fromEnv, 20_000, MAX_MATERIAL_CHARS);
  }
  return MAX_MATERIAL_CHARS;
}

/**
 * Outline step only — **much smaller** than `materialCharLimit` so the outline model
 * finishes in ~1–2 minutes. Stored `ingest_source_text` / module expand still uses full
 * `materialCharLimit`.
 */
function outlineMaterialCharLimit(profile: CourseBuildProfile): number {
  const moduleCap = materialCharLimit(profile);
  if (profile === "express") {
    return clampInt(envInt("COURSE_EXPRESS_OUTLINE_MATERIAL_CHARS", 6_000), 4_000, moduleCap);
  }
  if (profile === "fast") {
    return clampInt(envInt("COURSE_FAST_OUTLINE_MATERIAL_CHARS", 18_000), 8_000, moduleCap);
  }
  if (profile === "balanced") {
    return clampInt(
      envInt("COURSE_BALANCED_OUTLINE_MATERIAL_CHARS", 22_000),
      12_000,
      moduleCap
    );
  }
  return clampInt(envInt("COURSE_FULL_OUTLINE_MATERIAL_CHARS", 56_000), 24_000, moduleCap);
}

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

/** Shorter outline coverage for express/fast (fewer input tokens); full/balanced use `sourceCoverageRules`. */
function outlineCoverageBlock(profile: CourseBuildProfile): string {
  if (profile === "express") {
    return "COVERAGE: From this excerpt only, list the **main ideas** as **2 compact modules** (prefer 2) with short lesson_titles — skip fine detail.";
  }
  if (profile === "fast") {
    return "COVERAGE: Map obvious sections in this excerpt to modules; stay within the caps above.";
  }
  if (profile === "balanced") {
    return "COVERAGE: Cover this excerpt well; use headings to infer structure—keep the outline compact.";
  }
  return sourceCoverageRules("outline");
}

/** Injected into module / monolith prompts (and full outline via `outlineCoverageBlock`). */
function sourceCoverageRules(mode: "outline" | "module" | "monolith"): string {
  const core =
    "COVERAGE (critical): You must represent **every major topic, section, heading, and learning objective** in the uploaded material. Do not stop early, skim, or merge distinct concepts to save tokens. If the deck is long or dense, use **more** lesson entries (up to the stated caps) and **more** modules (up to the stated caps) rather than skipping later sections.";
  if (mode === "outline") {
    return `${core} The excerpt below may omit the document middle for speed—use headings/numbering in the head and tail to infer later topics. Modules and lesson_titles together should still **map** the full arc of the course; full lessons use a longer excerpt later.`;
  }
  if (mode === "module") {
    return `${core} Output **exactly one full lesson per planned lesson title** below, in the **same order** and **same count**. Do not omit, merge, or collapse lessons; each title must become substantive lesson content grounded in the material.`;
  }
  return `${core} Across the full course JSON, every substantive part of the source should appear in some lesson; do not only cover the introduction.`;
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
  } else if (profile === "express") {
    sizeRules = `Rules for output size (critical for speed): use **2 or 3** modules only. At most **3 lessons per module**. Each lesson "content" must be **under 400 words** — concise teaching, not a textbook.

QUIZ (critical): Each module needs **at least 3 questions**, with **at least 1** type free_response (reference_answer required). The rest MCQ with exactly 4 choices.`;
    quizFooter =
      "Meet the minimums above (≥3 quiz items per module, including ≥1 free_response). Only return valid JSON. No markdown fences, no extra text. Base everything on the uploaded material.";
  } else if (profile === "fast") {
    sizeRules = `Rules for output size (important): use at least 2 modules and at most 4 unless the source is extremely short. Keep each lesson "content" clear and instructive but under roughly 500 words. Every module must include at least one lesson.

QUIZ (critical): Each module needs a practical practice set — **at least 4 questions per module**, with **at least 1 item** whose type is free_response (short written answer). The rest should be mcq. MCQs must have exactly 4 choices. Every free_response **must** include **reference_answer** (snake_case, non-empty, concise rubric).`;
    quizFooter =
      "Include enough quiz objects per module to meet the minimums above. Do not omit free_response types — they are required. Only return valid JSON. No markdown fences, no extra text. Base everything strictly on the uploaded material — do not add outside information.";
  } else if (profile === "balanced") {
    const maxBalMods = clampInt(envInt("COURSE_BALANCED_MAX_MODULES", 3), 2, 6);
    sizeRules = `Rules for output size (important): use at least 2 modules and at most ${maxBalMods} unless the source is extremely short. Keep each lesson "content" clear; aim under roughly 500 words per lesson. Every module must include at least one lesson.

QUIZ (critical): Each module needs **at least 4 questions per module**, with **at least 1** type free_response (short written answer). The rest should be mcq. MCQs must have exactly 4 choices. Every free_response **must** include **reference_answer** (snake_case, non-empty, concise rubric).`;
    quizFooter =
      "Include enough quiz objects per module to meet the minimums above. Do not omit free_response types — they are required. Only return valid JSON. No markdown fences, no extra text. Base everything strictly on the uploaded material — do not add outside information.";
  } else {
    const _bad: never = profile;
    throw new Error(`Unhandled course build profile: ${String(_bad)}`);
  }

  return `You are an expert course designer and educator. You have been given raw course material (lecture slides, syllabi, notes). Your job is NOT to summarize this material. Your job is to use it as a source to BUILD a complete, professional, structured course that a student would genuinely pay for.

${sizeRules}

${titleStyleRules()}

${sourceCoverageRules("monolith")}

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
  opts?: { maxAttempts?: number; acquireMaxWaitMs?: number }
): Promise<Anthropic.Message> {
  let lastErr: unknown;
  const maxAttempts = opts?.maxAttempts ?? 5;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await acquireClaudeBudget({
        estOutputTokens: params.max_tokens,
        messages: params.messages as { content: unknown }[],
        ...(opts?.acquireMaxWaitMs !== undefined
          ? { maxWaitMs: opts.acquireMaxWaitMs }
          : {}),
      });
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

/** Optional: push live model output during PDF ingest so the UI can show a ChatGPT-style preview. */
export type PdfIngestStreamSink = {
  push: (textTail: string) => Promise<void>;
  clear: () => Promise<void>;
};

const PDF_STREAM_PREVIEW_CAP = 28_000;

async function readPdfIngestStreamOnce(
  anthropic: Anthropic,
  params: {
    model: string;
    max_tokens: number;
    temperature?: number;
    messages: Anthropic.MessageCreateParams["messages"];
  },
  streamSink: PdfIngestStreamSink,
  acquireMaxWaitMs?: number
): Promise<string> {
  await acquireClaudeBudget({
    estOutputTokens: params.max_tokens,
    messages: params.messages as { content: unknown }[],
    ...(acquireMaxWaitMs !== undefined ? { maxWaitMs: acquireMaxWaitMs } : {}),
  });
  const stream = anthropic.messages.stream({
    model: params.model,
    max_tokens: params.max_tokens,
    ...(params.temperature !== undefined
      ? { temperature: params.temperature }
      : {}),
    messages: params.messages,
  });

  let accumulated = "";
  let lastPushAt = 0;
  /** Lower = fresher `stream_preview` for live outline UI (more DB writes). */
  const throttleMs = 90;

  for await (const event of stream) {
    if (event.type === "content_block_delta") {
      const delta = event.delta as { type?: string; text?: string };
      if (delta.type === "text_delta" && typeof delta.text === "string") {
        accumulated += delta.text;
        const now = Date.now();
        if (now - lastPushAt >= throttleMs) {
          lastPushAt = now;
          await streamSink.push(accumulated.slice(-PDF_STREAM_PREVIEW_CAP));
        }
      }
    }
  }

  const finalMessage = await stream.finalMessage();
  const text = extractTextBlock(finalMessage);
  await streamSink.push(text.slice(-PDF_STREAM_PREVIEW_CAP));
  return text;
}

/**
 * One user-message → assistant text. Uses Anthropic streaming when `streamSink` is set so
 * `push` receives a growing tail of the JSON as tokens arrive. One stream try for speed;
 * on failure, falls back to non-streaming (PDF ingest runner also applies rate-limit retries).
 */
async function invokeUserMessageForPdfText(
  anthropic: Anthropic,
  params: {
    model: string;
    max_tokens: number;
    temperature?: number;
    messages: Anthropic.MessageCreateParams["messages"];
  },
  streamSink: PdfIngestStreamSink | undefined,
  maxAttemptsWhenNotStreaming: number,
  /**
   * Max time to wait for global Claude budget before proceeding. Pass a small
   * value for the outline / structure-plan phase so "planning" never stalls
   * behind module writing (those calls are tiny, so a brief overshoot is safe
   * and the reactive 429 backoff backstops it). Modules use the default.
   */
  acquireMaxWaitMs?: number
): Promise<string> {
  if (!streamSink) {
    const msg = await createMessageWithRetries(
      anthropic,
      {
        model: params.model,
        max_tokens: params.max_tokens,
        ...(params.temperature !== undefined
          ? { temperature: params.temperature }
          : {}),
        messages: params.messages,
      },
      { maxAttempts: maxAttemptsWhenNotStreaming, acquireMaxWaitMs }
    );
    return extractTextBlock(msg);
  }

  try {
    return await readPdfIngestStreamOnce(
      anthropic,
      params,
      streamSink,
      acquireMaxWaitMs
    );
  } catch (err) {
    console.warn(
      "[study-generation] PDF ingest stream failed; falling back to non-streaming",
      err
    );
    await streamSink.clear().catch(() => {});
    const fallbackAttempts = Math.max(maxAttemptsWhenNotStreaming, 3);
    const msg = await createMessageWithRetries(
      anthropic,
      {
        model: params.model,
        max_tokens: params.max_tokens,
        ...(params.temperature !== undefined
          ? { temperature: params.temperature }
          : {}),
        messages: params.messages,
      },
      { maxAttempts: fallbackAttempts, acquireMaxWaitMs }
    );
    return extractTextBlock(msg);
  }
}

async function repairPayloadJson(
  anthropic: Anthropic,
  brokenAssistantText: string,
  profile: CourseBuildProfile
): Promise<CoursePayload> {
  const prompt = `You previously returned JSON that could not be parsed or validated. Output ONLY a single valid JSON object for the same course schema (title, description, modules with lessons and quiz arrays). Fix truncation, stray commas, or malformed strings. No markdown, no commentary.

Broken output (repair it):
${brokenAssistantText.slice(0, 120_000)}`;

  const repairPayloadMax =
    profile === "express"
      ? 12_288
      : profile === "fast"
        ? 16_384
        : profile === "balanced"
          ? 24_576
          : 32_768;

  const msg = await createMessageWithRetries(
    anthropic,
    {
      model: resolveCourseModel(profile),
      max_tokens: repairPayloadMax,
      temperature: 0.1,
      messages: [{ role: "user", content: prompt }],
    },
    {
      maxAttempts:
        profile === "express" ? 1 : profile === "fast" ? 2 : profile === "balanced" ? 3 : 4,
    }
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

  const trimmed = truncateMaterial(materialText, materialCharLimit(profile));
  const instruction = courseInstruction(trimmed, profile);

  const monolithMaxTokens =
    profile === "express"
      ? 14_336
      : profile === "fast"
        ? 20_480
        : profile === "balanced"
          ? 28_672
          : 32_768;

  const msg = await createMessageWithRetries(
    anthropic,
    {
      model: resolveCourseModel(profile),
      max_tokens: monolithMaxTokens,
      temperature: 0.2,
      messages: [{ role: "user", content: instruction }],
    },
    {
      maxAttempts:
        profile === "express" ? 1 : profile === "fast" ? 2 : profile === "balanced" ? 4 : 5,
    }
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

function outlineMaxTokens(profile: CourseBuildProfile): number {
  if (profile === "express") {
    return clampInt(envInt("COURSE_EXPRESS_OUTLINE_MAX_TOKENS", 2048), 1024, 4096);
  }
  if (profile === "fast") {
    return clampInt(envInt("COURSE_FAST_OUTLINE_MAX_TOKENS", 4096), 1024, 8192);
  }
  if (profile === "balanced") {
    return clampInt(envInt("COURSE_BALANCED_OUTLINE_MAX_TOKENS", 4096), 4096, 8192);
  }
  return clampInt(envInt("COURSE_FULL_OUTLINE_MAX_TOKENS", 10_240), 4096, 16_384);
}

function selfStudyBlock(studyContext: string): string {
  return `\n=== LEARNER CONTEXT (self-study mode) ===\nThe student described their study situation as follows. Use this to calibrate the ENTIRE course — depth, focus, pacing, and terminology:\n"${studyContext}"\nApply this context throughout: adjust module emphasis, skip or compress topics they already know, expand areas they are struggling with, and use the exam timeline or goal if one is mentioned.\n=== END LEARNER CONTEXT ===\n`;
}

function outlineInstruction(
  materialText: string,
  profile: CourseBuildProfile,
  studyContext?: string
): string {
  let moduleCount: string;
  let maxLessonTitles: number;
  if (profile === "express") {
    const maxModules = clampInt(envInt("COURSE_EXPRESS_MAX_MODULES", 3), 2, 3);
    moduleCount = `Use **2 to ${maxModules}** modules — **prefer 2** so the build finishes in minutes.`;
    maxLessonTitles = clampInt(envInt("COURSE_EXPRESS_MAX_LESSON_TITLES", 3), 2, 3);
  } else if (profile === "fast") {
    const maxModules = clampInt(envInt("COURSE_FAST_MAX_MODULES", 3), 1, 6);
    moduleCount = `Use **2 to ${maxModules}** modules so the course can be built quickly.`;
    maxLessonTitles = clampInt(envInt("COURSE_FAST_MAX_LESSON_TITLES", 4), 1, 6);
  } else if (profile === "balanced") {
    const maxModules = clampInt(envInt("COURSE_BALANCED_MAX_MODULES", 3), 2, 6);
    moduleCount = `Use **2 to ${maxModules}** modules. Prefer a compact plan that still covers the excerpt.`;
    maxLessonTitles = clampInt(envInt("COURSE_BALANCED_MAX_LESSON_TITLES", 6), 2, 8);
  } else {
    moduleCount =
      "Use **2 to 8** modules depending on how much content the source has.";
    maxLessonTitles = clampInt(envInt("COURSE_FULL_MAX_LESSON_TITLES", 8), 2, 12);
  }

  return `You are an expert course designer. From the material below, output ONLY a compact JSON **outline** (no full lesson bodies, no quiz questions).
${studyContext ? selfStudyBlock(studyContext) : ""}
${moduleCount}
Each module must include: numeric "id" (1, 2, 3, … in order), "title", and "lesson_titles" (array of **1 to ${maxLessonTitles}** short strings — concise titles only, no pasted paragraphs). For dense excerpts, use many distinct titles (up to the max) so each major idea can get its own lesson later.

Exact shape:
{
  "title": "course title",
  "description": "compelling course description",
  "modules": [
    { "id": 1, "title": "module title", "lesson_titles": ["Lesson one", "Lesson two"] }
  ]
}

${titleStyleRules()}

${outlineCoverageBlock(profile)}

Rules: base everything on the material; do not invent unrelated topics. No markdown fences, no commentary.

--- MATERIAL START ---
${materialText}
--- MATERIAL END ---`;
}

/**
 * Style guidance shared by the outline and monolith course prompts so the
 * resulting course title, module titles, and lesson titles read as short
 * topic labels — not full sentences. Without this, Claude tends to default
 * to verbose "Master the fundamentals of …" / "Explore how …" patterns
 * that overflow the UI and feel repetitive across modules.
 */
function titleStyleRules(): string {
  return `TITLE STYLE (very important — follow strictly):
- **course title**: short topic name, 2 to 5 words. Example: "Ionic Bonding", "World War II Causes", "Linear Algebra Basics". NOT "A Comprehensive Guide to ...".
- **module titles**: short noun phrases, **2 to 5 words each, max 40 characters**. Just name the topic. Example: "Covalent Bonding", "VSEPR Geometry", "Ideal Gas Law". **NEVER** start with "Master", "Explore", "Understand", "Introduction to", "Overview of", "Deep Dive into", "Foundations of", "The Fundamentals of", or any verb-led phrase.
- **lesson_titles**: short noun phrases, **3 to 6 words each, max 50 characters**. Example: "Electron Sharing", "Bond Polarity", "Lewis Structures". Same forbidden openers as module titles.
- **description**: ONE short sentence under ~20 words. No marketing fluff, no "designed for self-study", no second paragraph.

Repetition rule: across the whole outline, no two modules (or two lesson titles) may start with the same first word. If you'd produce "Master the X" and "Master the Y", rewrite both as bare topic names.`;
}

function moduleQuizRules(profile: CourseBuildProfile): string {
  if (profile === "full") {
    return `QUIZ (this module only): **at least 8** questions, with **at least 4** type free_response (include reference_answer snake_case). The rest MCQ with exactly 4 choices each.`;
  }
  if (profile === "express") {
    return `QUIZ (this module only): **at least 3** questions — **at least 1** type free_response (reference_answer required). The rest MCQ with exactly 4 choices each.`;
  }
  if (profile === "fast") {
    const quizMin = clampInt(envInt("COURSE_FAST_QUIZ_MIN", 4), 1, 12);
    const frMin = clampInt(envInt("COURSE_FAST_FREE_RESPONSE_MIN", 1), 0, quizMin);
    return `QUIZ (this module only): **at least ${quizMin}** questions, with **at least ${frMin}** type free_response (reference_answer required). The rest MCQ, 4 choices each.`;
  }
  if (profile === "balanced") {
    return `QUIZ (this module only): **at least 4** questions, with **at least 1** type free_response (reference_answer required). The rest MCQ with exactly 4 choices each.`;
  }
  const _never: never = profile;
  return _never;
}

function moduleInstruction(
  materialText: string,
  outline: CourseOutlinePayload,
  moduleIndex: number,
  profile: CourseBuildProfile,
  studyContext?: string
): string {
  const stub = outline.modules[moduleIndex];
  const n = outline.modules.length;
  const titles = stub.lesson_titles.map((t) => JSON.stringify(t)).join(", ");
  const styleRule =
    profile === "express"
      ? `STYLE (express): Short, high-signal lessons (**under ~400 words** each). Clarity beats length.`
      : profile === "fast"
        ? `STYLE (fast): Write clearly with enough detail to teach (use examples, connect ideas), but avoid unnecessary fluff.`
        : profile === "balanced"
          ? `STYLE (balanced): Teach clearly with examples; aim **under ~500 words** per lesson.`
          : "";
  const lessonRequirements =
    profile === "express"
      ? `For EACH lesson: include **2** key_terms (term+definition) and **2** short examples (strings).`
      : profile === "fast"
        ? `For EACH lesson: include 2–4 key_terms (term+definition) and exactly 2 real-world examples (short strings).`
        : profile === "balanced"
          ? `For EACH lesson: include 2–4 key_terms (term+definition) and 2 short real-world examples (strings).`
          : `For EACH lesson: include key_terms (term+definition) and examples (strings).`;

  return `You are expanding **one module** of a structured course (${moduleIndex + 1} of ${n}). Course title: ${JSON.stringify(outline.title)}. Module id **must be** ${stub.id}. Module title **must be** ${JSON.stringify(stub.title)}.
${studyContext ? selfStudyBlock(studyContext) : ""}
Create one full module object: lessons (one per planned lesson title below, in order — same count as lesson_titles, each with rich "content", "key_terms", "examples"), plus quiz.

Planned lesson titles for this module: ${titles}.

${sourceCoverageRules("module")}

${styleRule}
${lessonRequirements}

${moduleQuizRules(profile)}

Return ONLY valid JSON in this exact wrapper (no markdown):
{ "module": { "id": ${stub.id}, "title": ${JSON.stringify(stub.title)}, "lessons": [...], "quiz": [...] } }

Base all teaching strictly on the source material.

--- MATERIAL START ---
${materialText}
--- MATERIAL END ---`;
}

async function repairOutlineJson(
  anthropic: Anthropic,
  brokenAssistantText: string,
  profile: CourseBuildProfile
): Promise<CourseOutlinePayload> {
  const prompt = `You returned JSON that could not be parsed as a course outline (title, description, modules with id, title, lesson_titles arrays). Output ONLY one valid JSON object. No markdown.

Broken output (repair):
${brokenAssistantText.slice(0, 60_000)}`;

  const msg = await createMessageWithRetries(
    anthropic,
    {
      model: resolveOutlineModel(profile),
      max_tokens: outlineMaxTokens(profile),
      temperature: 0.1,
      messages: [{ role: "user", content: prompt }],
    },
    {
      maxAttempts: profile === "full" ? 3 : 1,
    }
  );

  const text = extractTextBlock(msg);
  let repaired: unknown;
  try {
    repaired = JSON.parse(stripJsonFence(text));
  } catch {
    throw new Error("Claude did not return valid JSON after outline repair");
  }
  return parseCourseOutlinePayload(repaired);
}

async function repairModuleJson(
  anthropic: Anthropic,
  brokenAssistantText: string,
  profile: CourseBuildProfile
): Promise<CourseModule> {
  const requirements =
    profile === "express"
      ? `Requirements for EACH lesson (express): include 2 key_terms (term+definition) and 2 examples (short strings). Do not leave key_terms empty.`
      : profile === "fast"
        ? `Requirements for EACH lesson (fast): include 2–4 key_terms (term+definition) and at least 2 examples (short strings). Do not leave key_terms empty.`
        : `Requirements for EACH lesson: include key_terms (term+definition) and examples (strings).`;

  const prompt = `You returned JSON that could not be parsed or did not meet requirements for a single course "module" (id, title, lessons[], quiz[]). Output ONLY: { "module": { ... } } with valid JSON. No markdown.

${requirements}

Broken output (repair):
${brokenAssistantText.slice(0, 100_000)}`;

  const moduleRepairMax =
    profile === "express"
      ? 6144
      : profile === "fast"
        ? 8192
        : profile === "balanced"
          ? 10_240
          : 24_576;

  const msg = await createMessageWithRetries(
    anthropic,
    {
      model: resolveCourseModel(profile),
      max_tokens: moduleRepairMax,
      temperature: 0.1,
      messages: [{ role: "user", content: prompt }],
    },
    {
      maxAttempts:
        profile === "express" || profile === "fast" || profile === "balanced"
          ? 2
          : 3,
    }
  );

  const text = extractTextBlock(msg);
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stripJsonFence(text)) as Record<string, unknown>;
  } catch {
    throw new Error("Claude did not return valid JSON after module repair");
  }
  const mod = parsed.module;
  return parseCourseModule(mod);
}

function moduleNeedsLessonGlossary(m: CourseModule): boolean {
  return m.lessons.some(
    (l) => l.key_terms.length === 0 || l.examples.length === 0
  );
}

/** Second pass: model omitted glossary fields but JSON was otherwise valid. */
async function repairModuleMissingLessonFields(
  anthropic: Anthropic,
  module: CourseModule,
  profile: CourseBuildProfile
): Promise<CourseModule> {
  const payload = JSON.stringify({ module });
  const clipped =
    payload.length > 115_000 ? `${payload.slice(0, 115_000)}\n…(truncated)` : payload;
  const prompt = `You are given JSON for one course "module". Return ONLY valid JSON: { "module": { ... } }.

Rules:
- Keep the same module id, module title, lesson titles, lesson content, and quiz as much as possible.
- REQUIRED: every lesson must have non-empty key_terms (array of objects with "term" and "definition" strings). At least 2 per lesson.
- REQUIRED: every lesson must have non-empty examples (array of strings). At least 2 per lesson.
- Use snake_case keys: "key_terms" and "examples" (not camelCase).

${clipped}`;

  const glossaryRepairMax =
    profile === "express"
      ? 5120
      : profile === "fast"
        ? 8192
        : profile === "balanced"
          ? 8192
          : 18_432;

  const msg = await createMessageWithRetries(
    anthropic,
    {
      model: resolveCourseModel(profile),
      max_tokens: glossaryRepairMax,
      temperature: 0.15,
      messages: [{ role: "user", content: prompt }],
    },
    {
      maxAttempts:
        profile === "fast" || profile === "balanced" ? 2 : 3,
    }
  );

  const text = extractTextBlock(msg);
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFence(text));
  } catch {
    throw new Error("Claude did not return valid JSON after glossary repair");
  }
  const obj = parsed as Record<string, unknown>;
  return parseCourseModule(obj.module);
}

async function ensureModuleLessonFields(
  anthropic: Anthropic,
  module: CourseModule,
  profile: CourseBuildProfile
): Promise<CourseModule> {
  let out = module;
  for (let i = 0; i < 2 && moduleNeedsLessonGlossary(out); i++) {
    out = await repairModuleMissingLessonFields(anthropic, out, profile);
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────
// Content-driven structure planning (feature flag STRUCTURE_PLANNING).
// One Claude call groups extracted chunks into modules/lessons regardless of
// file boundaries. Input is chunk summaries only (no full text) to save tokens.
// ────────────────────────────────────────────────────────────────────────

function structurePlanInstruction(
  chunkSummaries: IngestChunkSummary[],
  studyContext?: string
): string {
  const chunkJson = JSON.stringify(chunkSummaries, null, 0);
  return `You are an expert course architect. You are given a list of CONTENT CHUNKS extracted from one or more uploaded files. Group them into a coherent course structure based on the CONTENT, not on which file they came from.

CRITICAL GROUPING RULES:
- File boundaries do NOT equal lesson boundaries.
- A single lesson MAY span multiple files (e.g. "Lecture 3 Part 1", "Part 2", "Part 3" almost certainly belong to the same lesson or module).
- One file MAY contain multiple lessons (a long PDF with several chapters/sections becomes several lessons).
- Some files/chunks may be SUPPLEMENTARY to a lesson (examples, appendices, problem sets) rather than their own lesson — attach them to the most relevant lesson instead of giving them a standalone lesson.
- Decide grouping using: chunk titles/headings, topic continuity, chunk length (approxChars), and filename patterns (e.g. "Part 1/2/3", "Week N", "Chapter N").
${studyContext ? selfStudyBlock(studyContext) : ""}
Every chunk id that carries real teaching content should be referenced by exactly one lesson via source_chunk_ids (a chunk may be referenced by more than one lesson only if genuinely shared). Do not invent chunk ids that are not in the list.

${titleStyleRules()}

Output ONLY this strict JSON (no markdown, no commentary):
{
  "title": "short course title (2 to 5 words)",
  "description": "one short sentence describing the course",
  "modules": [
    {
      "title": "module title",
      "summary": "one-sentence description of the module",
      "lessons": [
        {
          "title": "lesson title",
          "summary": "one-sentence description of the lesson",
          "source_chunk_ids": ["c001", "c002"]
        }
      ]
    }
  ]
}

--- CONTENT CHUNKS (JSON) ---
${chunkJson}
--- END CONTENT CHUNKS ---`;
}

async function repairStructurePlanJson(
  anthropic: Anthropic,
  brokenAssistantText: string,
  profile: CourseBuildProfile
): Promise<CourseStructurePlan> {
  const prompt = `You returned JSON that could not be parsed as a course structure plan. Output ONLY one valid JSON object of the shape { "modules": [ { "title", "summary", "lessons": [ { "title", "summary", "source_chunk_ids": [] } ] } ] }. No markdown.

Broken output (repair):
${brokenAssistantText.slice(0, 60_000)}`;

  const msg = await createMessageWithRetries(
    anthropic,
    {
      model: resolveOutlineModel(profile),
      max_tokens: planMaxTokens(profile),
      temperature: 0.1,
      messages: [{ role: "user", content: prompt }],
    },
    { maxAttempts: profile === "full" ? 3 : 1 }
  );

  const text = extractTextBlock(msg);
  let repaired: unknown;
  try {
    repaired = JSON.parse(stripJsonFence(text));
  } catch {
    throw new Error("Claude did not return valid JSON after plan repair");
  }
  return parseCourseStructurePlan(repaired);
}

function planMaxTokens(profile: CourseBuildProfile): number {
  if (profile === "express") {
    return clampInt(envInt("COURSE_PLAN_MAX_TOKENS", 3072), 1024, 6144);
  }
  if (profile === "fast" || profile === "balanced") {
    return clampInt(envInt("COURSE_PLAN_MAX_TOKENS", 5120), 2048, 10_240);
  }
  return clampInt(envInt("COURSE_PLAN_MAX_TOKENS", 8192), 4096, 16_384);
}

/**
 * Plan a course structure from chunk summaries (one Claude call). Returns a
 * plan whose lessons reference chunk ids; file boundaries are ignored.
 * Routed through the same SDK setup as the outline; callers should still wrap
 * this in `withAnthropicRateLimitRetries` like other ingest AI calls.
 */
export async function planCourseStructureFromChunks(
  chunkSummaries: IngestChunkSummary[],
  streamSink?: PdfIngestStreamSink,
  studyContext?: string
): Promise<CourseStructurePlan> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY");
  }
  if (chunkSummaries.length === 0) {
    throw new Error("No chunks to plan a course structure from");
  }

  const profile = resolveCourseBuildProfile();
  const anthropic = new Anthropic({
    apiKey,
    timeout: getPdfAnthropicTimeoutMs(),
    maxRetries: 0,
  });

  const instruction = structurePlanInstruction(chunkSummaries, studyContext);
  const maxAttempts = profile === "express" || profile === "fast" ? 1 : 2;

  const rawText = await invokeUserMessageForPdfText(
    anthropic,
    {
      model: resolveOutlineModel(profile),
      max_tokens: planMaxTokens(profile),
      temperature: 0.15,
      messages: [{ role: "user", content: instruction }],
    },
    streamSink,
    maxAttempts,
    OUTLINE_BUDGET_WAIT_MS
  );

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFence(rawText));
  } catch {
    return repairStructurePlanJson(anthropic, rawText, profile);
  }
  try {
    return parseCourseStructurePlan(parsed);
  } catch (e) {
    console.warn("[study-generation] plan validation failed; repairing", e);
    return repairStructurePlanJson(anthropic, rawText, profile);
  }
}

/** Convert a structure plan into the existing outline shape (expand/finalize unchanged). */
export function structurePlanToOutline(
  plan: CourseStructurePlan,
  fallbackTitle?: string
): CourseOutlinePayload {
  const modules = plan.modules.map((m, i) => ({
    id: i + 1,
    title: m.title,
    lesson_titles: m.lessons.map((l) => l.title),
  }));
  const title =
    plan.title?.trim() ||
    fallbackTitle?.trim() ||
    modules[0]?.title ||
    "Course";
  const description =
    plan.description?.trim() || "A course built from your uploaded materials.";
  return { title, description, modules };
}

/**
 * Assemble index-aligned per-module source text from each module's lessons'
 * source_chunk_ids. A module's text is the concatenation (in chunk order) of
 * every chunk its lessons reference, truncated to the module char budget.
 * Modules with no resolvable chunk ids get an empty string (caller falls back
 * to the whole combined source text).
 */
export function assembleModuleSourcesFromPlan(
  plan: CourseStructurePlan,
  chunks: IngestChunk[]
): string[] {
  const profile = resolveCourseBuildProfile();
  const cap = materialCharLimit(profile);
  const byId = new Map<string, IngestChunk>();
  for (const c of chunks) byId.set(c.id, c);
  const orderOf = new Map<string, number>();
  chunks.forEach((c, i) => orderOf.set(c.id, i));

  return plan.modules.map((m) => {
    const ids = new Set<string>();
    for (const lesson of m.lessons) {
      for (const id of lesson.source_chunk_ids) ids.add(id);
    }
    const ordered = [...ids]
      .filter((id) => byId.has(id))
      .sort((a, b) => (orderOf.get(a) ?? 0) - (orderOf.get(b) ?? 0));
    if (ordered.length === 0) return "";
    const blocks = ordered.map((id) => {
      const c = byId.get(id)!;
      return `[from ${c.sourceFileName} — ${c.position}]\n${c.text}`;
    });
    return truncateMaterial(blocks.join("\n\n"), cap);
  });
}

/** Phase 1 of chunked PDF ingest — small JSON, usually finishes quickly. */
export async function generateCourseOutlineFromMaterial(
  materialText: string,
  streamSink?: PdfIngestStreamSink,
  studyContext?: string
): Promise<CourseOutlinePayload> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY");
  }

  const profile = resolveCourseBuildProfile();
  const anthropic = new Anthropic({
    apiKey,
    timeout: getPdfAnthropicTimeoutMs(),
    maxRetries: 0,
  });

  const trimmed = truncateMaterial(
    materialText,
    outlineMaterialCharLimit(profile)
  );
  const instruction = outlineInstruction(trimmed, profile, studyContext);

  const maxAttempts =
    profile === "express" || profile === "fast" || profile === "balanced"
      ? 1
      : 4;

  const rawText = await invokeUserMessageForPdfText(
    anthropic,
    {
      model: resolveOutlineModel(profile),
      max_tokens: outlineMaxTokens(profile),
      temperature: 0.15,
      messages: [{ role: "user", content: instruction }],
    },
    streamSink,
    maxAttempts,
    OUTLINE_BUDGET_WAIT_MS
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFence(rawText));
  } catch {
    return repairOutlineJson(anthropic, rawText, profile);
  }

  try {
    return parseCourseOutlinePayload(parsed);
  } catch (e) {
    console.warn("[study-generation] outline validation failed; repairing", e);
    return repairOutlineJson(anthropic, rawText, profile);
  }
}

function moduleMaxTokens(profile: CourseBuildProfile): number {
  if (profile === "express") {
    return clampInt(envInt("COURSE_EXPRESS_MODULE_MAX_TOKENS", 5120), 3072, 8192);
  }
  if (profile === "fast") {
    return clampInt(envInt("COURSE_FAST_MODULE_MAX_TOKENS", 6144), 2048, 12_288);
  }
  if (profile === "full") return 30_720;
  return clampInt(envInt("COURSE_BALANCED_MODULE_MAX_TOKENS", 8192), 6144, 24_576);
}

/** Expand one module for chunked PDF ingest (separate server invocation). */
export async function generateCourseModuleFromMaterial(
  materialText: string,
  outline: CourseOutlinePayload,
  moduleIndex: number,
  streamSink?: PdfIngestStreamSink,
  studyContext?: string
): Promise<CourseModule> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY");
  }
  if (moduleIndex < 0 || moduleIndex >= outline.modules.length) {
    throw new Error("Invalid module index");
  }

  const profile = resolveCourseBuildProfile();
  const anthropic = new Anthropic({
    apiKey,
    timeout: getPdfAnthropicTimeoutMs(),
    maxRetries: 0,
  });

  const trimmed = truncateMaterial(materialText, materialCharLimit(profile));
  const instruction = moduleInstruction(trimmed, outline, moduleIndex, profile, studyContext);

  const maxAttempts =
    profile === "express" || profile === "fast"
      ? 1
      : profile === "balanced"
        ? 3
        : 5;

  const rawText = await invokeUserMessageForPdfText(
    anthropic,
    {
      model: resolveCourseModel(profile),
      max_tokens: moduleMaxTokens(profile),
      temperature: 0.2,
      messages: [{ role: "user", content: instruction }],
    },
    streamSink,
    maxAttempts
  );

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFence(rawText));
  } catch {
    let repaired = await repairModuleJson(anthropic, rawText, profile);
    repaired = await ensureModuleLessonFields(anthropic, repaired, profile);
    return repaired;
  }

  try {
    const obj = parsed as Record<string, unknown>;
    const mod = obj.module;
    const courseMod = parseCourseModule(mod);
    const expectedId = outline.modules[moduleIndex].id;
    const normalized = courseMod.id !== expectedId ? { ...courseMod, id: expectedId } : courseMod;

    return await ensureModuleLessonFields(anthropic, normalized, profile);
  } catch (e) {
    console.warn("[study-generation] module validation failed; repairing", e);
    let repaired = await repairModuleJson(anthropic, rawText, profile);
    repaired = await ensureModuleLessonFields(anthropic, repaired, profile);
    return repaired;
  }
}
