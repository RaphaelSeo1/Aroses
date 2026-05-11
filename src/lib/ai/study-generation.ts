import Anthropic from "@anthropic-ai/sdk";
import {
  APIConnectionError,
  APIError,
  RateLimitError,
} from "@anthropic-ai/sdk";
import {
  type CourseOutlinePayload,
  parseCourseModule,
  parseCourseOutlinePayload,
  parseCoursePayload,
  stripJsonFence,
} from "@/lib/ai/course-payload";
import { getPdfAnthropicTimeoutMs } from "@/lib/pdf-route-duration";
import type { CourseModule, CoursePayload } from "@/types/course";

export type { CourseOutlinePayload } from "@/lib/ai/course-payload";

/**
 * PDF ingest uses a **chunked** pipeline (outline in `runPdfIngestJob`, then one module per
 * `POST /api/process-pdf/expand`) so each invocation stays within the serverless wall clock.
 *
 * Default **`fast`**: smaller per-module JSON. Set `COURSE_BUILD_PROFILE=balanced` or `full`
 * for richer courses. **`balanced`** is tuned for speed (fewer modules than `full`, lighter than before).
 * Optional: `COURSE_BALANCED_MAX_MODULES`, `COURSE_BALANCED_MAX_LESSON_TITLES`,
 * `COURSE_BALANCED_MODULE_MAX_TOKENS`, `COURSE_BALANCED_MATERIAL_CHARS`, `COURSE_FAST_MAX_LESSON_TITLES`.
 * **`balanced`**: smaller `COURSE_BALANCED_MATERIAL_CHARS` input; outline defaults to **Haiku**;
 * modules use **Sonnet** unless `ANTHROPIC_COURSE_MODEL` is set (same model for both). Outline-only:
 * `ANTHROPIC_OUTLINE_MODEL`.
 */
type CourseBuildProfile = "full" | "balanced" | "fast";

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
  return "fast";
}

/** Same truncation as outline/module generation — store on the job for expand steps. */
export function materialTextForPdfIngest(fullText: string): string {
  const profile = resolveCourseBuildProfile();
  return truncateMaterial(
    fullText.trim(),
    materialCharLimit(profile)
  );
}

/**
 * Optional `ANTHROPIC_COURSE_MODEL` overrides everything.
 * `fast` defaults to **Claude Haiku 4.5** (3.5 Haiku IDs are removed from the API — 404).
 */
function resolveCourseModel(profile: CourseBuildProfile): string {
  const override = process.env.ANTHROPIC_COURSE_MODEL?.trim();
  if (override) return override;
  if (profile === "fast") return "claude-haiku-4-5";
  return "claude-sonnet-4-6";
}

/**
 * Compact outline JSON — **`balanced`** uses Haiku when neither `ANTHROPIC_COURSE_MODEL` nor
 * `ANTHROPIC_OUTLINE_MODEL` is set, so phase 1 stays fast; modules still use Sonnet via
 * `resolveCourseModel`.
 */
function resolveOutlineModel(profile: CourseBuildProfile): string {
  const outlineOnly = process.env.ANTHROPIC_OUTLINE_MODEL?.trim();
  if (outlineOnly) return outlineOnly;
  const courseOverride = process.env.ANTHROPIC_COURSE_MODEL?.trim();
  if (courseOverride) return courseOverride;
  if (profile === "fast" || profile === "balanced") return "claude-haiku-4-5";
  return "claude-sonnet-4-6";
}

/** Rough input budget — large PDFs + long outputs often hit limits or timeouts. */
const MAX_MATERIAL_CHARS = 120_000;
/** Aggressively small for `fast` so outline/module calls stay quick. */
const FAST_MATERIAL_CHARS = 40_000;
/** `balanced`: smaller than full — outline + modules stay faster on long slide decks. */
const BALANCED_MATERIAL_CHARS = 52_000;

function materialCharLimit(profile: CourseBuildProfile): number {
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
    const maxBalMods = clampInt(envInt("COURSE_BALANCED_MAX_MODULES", 4), 2, 6);
    sizeRules = `Rules for output size (important): use at least 2 modules and at most ${maxBalMods} unless the source is extremely short. Keep each lesson "content" clear and instructive but under roughly 550 words so generation stays reasonably fast. Every module must include at least one lesson.

QUIZ (critical): Each module needs a practical practice set — **at least 5 questions per module**, with **at least 2 items** whose type is free_response (short written answer). The rest should be mcq. MCQs must have exactly 4 choices. Every free_response **must** include **reference_answer** (snake_case, non-empty, concise rubric).`;
    quizFooter =
      "Include enough quiz objects per module to meet the minimums above (≥5 per module, including ≥2 free_response). Do not omit free_response types — they are required. Only return valid JSON. No markdown fences, no extra text. Base everything strictly on the uploaded material — do not add outside information.";
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

function outlineInstruction(
  materialText: string,
  profile: CourseBuildProfile
): string {
  let moduleCount: string;
  let maxLessonTitles: number;
  if (profile === "full") {
    moduleCount =
      "Use **2 to 8** modules depending on how much content the source has.";
    maxLessonTitles = 5;
  } else if (profile === "fast") {
    const maxModules = clampInt(envInt("COURSE_FAST_MAX_MODULES", 3), 1, 8);
    moduleCount = `Use **2 to ${maxModules}** modules so the course can be built quickly.`;
    maxLessonTitles = clampInt(envInt("COURSE_FAST_MAX_LESSON_TITLES", 4), 1, 5);
  } else {
    const maxModules = clampInt(envInt("COURSE_BALANCED_MAX_MODULES", 4), 2, 6);
    moduleCount = `Use **2 to ${maxModules}** modules — prefer fewer, broader modules when the material allows (each module is generated separately).`;
    maxLessonTitles = clampInt(envInt("COURSE_BALANCED_MAX_LESSON_TITLES", 3), 1, 5);
  }

  return `You are an expert course designer. From the material below, output ONLY a compact JSON **outline** (no full lesson bodies, no quiz questions).

${moduleCount}
Each module must include: numeric "id" (1, 2, 3, … in order), "title", and "lesson_titles" (array of **1 to ${maxLessonTitles}** short strings — the titles of lessons you will expand later).

Exact shape:
{
  "title": "course title",
  "description": "compelling course description",
  "modules": [
    { "id": 1, "title": "module title", "lesson_titles": ["Lesson one", "Lesson two"] }
  ]
}

Rules: base everything on the material; do not invent unrelated topics. No markdown fences, no commentary.

--- MATERIAL START ---
${materialText}
--- MATERIAL END ---`;
}

function moduleQuizRules(profile: CourseBuildProfile): string {
  if (profile === "full") {
    return `QUIZ (this module only): **at least 8** questions, with **at least 4** type free_response (include reference_answer snake_case). The rest MCQ with exactly 4 choices each.`;
  }
  if (profile === "fast") {
    const quizMin = clampInt(envInt("COURSE_FAST_QUIZ_MIN", 3), 1, 12);
    const frMin = clampInt(envInt("COURSE_FAST_FREE_RESPONSE_MIN", 1), 0, quizMin);
    return `QUIZ (this module only): **at least ${quizMin}** questions, with **at least ${frMin}** type free_response (reference_answer required). The rest MCQ, 4 choices each.`;
  }
  return `QUIZ (this module only): **at least 5** questions, with **at least 2** type free_response (reference_answer required). Mix MCQ and free-response. MCQs: exactly 4 choices.`;
}

function moduleInstruction(
  materialText: string,
  outline: CourseOutlinePayload,
  moduleIndex: number,
  profile: CourseBuildProfile
): string {
  const stub = outline.modules[moduleIndex];
  const n = outline.modules.length;
  const titles = stub.lesson_titles.map((t) => JSON.stringify(t)).join(", ");
  const styleRule =
    profile === "fast"
      ? `STYLE (fast): Write clearly with enough detail to teach (use examples, connect ideas), but avoid unnecessary fluff.`
      : profile === "balanced"
        ? `STYLE (balanced): Teach clearly with examples; keep each lesson body focused and under roughly 550 words.`
        : "";
  const lessonRequirements =
    profile === "fast"
      ? `For EACH lesson: include 2–4 key_terms (term+definition) and exactly 2 real-world examples (short strings).`
      : profile === "balanced"
        ? `For EACH lesson: include 2–4 key_terms (term+definition) and 2 short real-world examples (strings).`
        : `For EACH lesson: include key_terms (term+definition) and examples (strings).`;

  return `You are expanding **one module** of a structured course (${moduleIndex + 1} of ${n}). Course title: ${JSON.stringify(outline.title)}. Module id **must be** ${stub.id}. Module title **must be** ${JSON.stringify(stub.title)}.

Create one full module object: lessons (one per planned lesson title below, in order — same count as lesson_titles, each with rich "content", "key_terms", "examples"), plus quiz.

Planned lesson titles for this module: ${titles}.

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
      max_tokens:
        profile === "fast"
          ? clampInt(envInt("COURSE_FAST_OUTLINE_MAX_TOKENS", 4096), 1024, 8192)
          : 8192,
      temperature: 0.1,
      messages: [{ role: "user", content: prompt }],
    },
    { maxAttempts: profile === "fast" ? 1 : profile === "balanced" ? 2 : 3 }
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
    profile === "fast"
      ? `Requirements for EACH lesson (fast): include 2–4 key_terms (term+definition) and at least 2 examples (short strings). Do not leave key_terms empty.`
      : `Requirements for EACH lesson: include key_terms (term+definition) and examples (strings).`;

  const prompt = `You returned JSON that could not be parsed or did not meet requirements for a single course "module" (id, title, lessons[], quiz[]). Output ONLY: { "module": { ... } } with valid JSON. No markdown.

${requirements}

Broken output (repair):
${brokenAssistantText.slice(0, 100_000)}`;

  const msg = await createMessageWithRetries(
    anthropic,
    {
      model: resolveCourseModel(profile),
      max_tokens: profile === "fast" ? 12_288 : 20_480,
      temperature: 0.1,
      messages: [{ role: "user", content: prompt }],
    },
    { maxAttempts: profile === "fast" ? 2 : 3 }
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

  const msg = await createMessageWithRetries(
    anthropic,
    {
      model: resolveCourseModel(profile),
      max_tokens: profile === "fast" ? 10_240 : 18_432,
      temperature: 0.15,
      messages: [{ role: "user", content: prompt }],
    },
    { maxAttempts: profile === "fast" ? 2 : 3 }
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

/** Phase 1 of chunked PDF ingest — small JSON, usually finishes quickly. */
export async function generateCourseOutlineFromMaterial(
  materialText: string
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

  const trimmed = truncateMaterial(materialText, materialCharLimit(profile));
  const instruction = outlineInstruction(trimmed, profile);

  const msg = await createMessageWithRetries(
    anthropic,
    {
      model: resolveOutlineModel(profile),
      max_tokens:
        profile === "fast"
          ? clampInt(envInt("COURSE_FAST_OUTLINE_MAX_TOKENS", 4096), 1024, 8192)
          : 8192,
      temperature: 0.2,
      messages: [{ role: "user", content: instruction }],
    },
    { maxAttempts: profile === "fast" ? 1 : profile === "balanced" ? 2 : 4 }
  );

  const rawText = extractTextBlock(msg);
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
  if (profile === "fast") {
    return clampInt(envInt("COURSE_FAST_MODULE_MAX_TOKENS", 4096), 1536, 16384);
  }
  if (profile === "full") return 30_720;
  return clampInt(envInt("COURSE_BALANCED_MODULE_MAX_TOKENS", 18_432), 8192, 24_576);
}

/** Expand one module for chunked PDF ingest (separate server invocation). */
export async function generateCourseModuleFromMaterial(
  materialText: string,
  outline: CourseOutlinePayload,
  moduleIndex: number
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
  const instruction = moduleInstruction(trimmed, outline, moduleIndex, profile);

  const msg = await createMessageWithRetries(
    anthropic,
    {
      model: resolveCourseModel(profile),
      max_tokens: moduleMaxTokens(profile),
      temperature: 0.2,
      messages: [{ role: "user", content: instruction }],
    },
    { maxAttempts: profile === "fast" ? 1 : 5 }
  );

  const rawText = extractTextBlock(msg);
  const stopReason = (msg as { stop_reason?: string }).stop_reason;
  if (stopReason === "max_tokens") {
    console.warn(
      "[study-generation] module Claude hit max_tokens; attempting repair"
    );
  }

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
