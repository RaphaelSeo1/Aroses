import Anthropic from "@anthropic-ai/sdk";
import {
  APIConnectionError,
  APIError,
  RateLimitError,
} from "@anthropic-ai/sdk";
import {
  type CourseOutlinePayload,
  type CourseStructurePlan,
  parseCourseStructurePlan,
  parseCourseModule,
  parseCourseModuleLoose,
  parseCourseOutlinePayload,
  parseCoursePayload,
  stripJsonFence,
} from "@/lib/ai/course-payload";
import type {
  IngestChunk,
  IngestChunkSummary,
} from "@/lib/study-ingest/chunking";
import { parsePageNumbersFromPosition } from "@/lib/study-ingest/chunk-position";
import { combinedSourceMarker } from "@/lib/study-ingest/combine";
import { filterChunkTableBlocksToPages } from "@/lib/study-ingest/enrich-chunks-with-page-tables";
import {
  enhanceTabularPlaintext,
  logMaterialTableDiagnostics,
  sanitizeLessonContent,
} from "@/lib/study-ingest/table-text";
import {
  buildDeterministicStructurePlan,
  normalizeStructurePlanTitles,
  structurePlanCoveragePromptBlock,
  structurePlanTargets,
  validateStructurePlanCoverage,
  type StructurePlanTitleOptions,
  type StructurePlanTargets,
} from "@/lib/structure-plan-coverage";
import {
  isBadIngestTitle,
  isGenericIngestPlaceholder,
  isWeakModuleTitle,
  moduleTitleFromLessonTitles,
  normalizeIngestDisplayTitle,
  resolveCourseDisplayTitle,
} from "@/lib/study-ingest/normalize-ingest-title";
import { generateAdditionalModuleQuizItems } from "@/lib/ai/expand-module-quiz";
import { auditModuleQuantitativeConsistency } from "@/lib/ai/course-quantitative-qa";
import {
  DEFAULT_COURSE_OUTPUT_LANGUAGE,
  formatOutputLanguageGenerationBlock,
  type CourseOutputLanguage,
} from "@/lib/course-output-language";
import { formatSelfStudyGenerationBlock } from "@/lib/self-study-context";
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

/** Target quiz bank size per module after generation (includes post-parse backfill). */
export function moduleQuizTarget(profile: CourseBuildProfile): number {
  if (profile === "full") {
    return clampInt(envInt("COURSE_FULL_QUIZ_MIN", 12), 4, 24);
  }
  if (profile === "express") {
    return clampInt(envInt("COURSE_EXPRESS_QUIZ_MIN", 10), 3, 16);
  }
  if (profile === "fast") {
    return clampInt(envInt("COURSE_FAST_QUIZ_MIN", 10), 3, 16);
  }
  if (profile === "balanced") {
    return clampInt(envInt("COURSE_BALANCED_QUIZ_MIN", 10), 3, 16);
  }
  const _never: never = profile;
  return _never;
}

function moduleFreeResponseMin(
  profile: CourseBuildProfile,
  target: number
): number {
  if (profile === "full") {
    return clampInt(
      envInt("COURSE_FULL_FREE_RESPONSE_MIN", Math.max(4, Math.floor(target / 2))),
      1,
      target
    );
  }
  return clampInt(
    envInt("COURSE_FREE_RESPONSE_MIN", Math.max(2, Math.floor(target / 3))),
    1,
    target
  );
}

async function ensureModuleQuizCount(
  module: CourseModule,
  profile: CourseBuildProfile,
  outputLanguage: CourseOutputLanguage = DEFAULT_COURSE_OUTPUT_LANGUAGE
): Promise<CourseModule> {
  const target = moduleQuizTarget(profile);
  let quiz = [...module.quiz];
  const minAcceptable =
    profile === "express" || profile === "fast"
      ? Math.min(4, target)
      : profile === "balanced"
        ? Math.min(6, target)
        : target;
  if (quiz.length >= minAcceptable) return module;
  if (quiz.length >= target) return module;

  console.info(
    `[study-generation] module ${module.id} quiz backfill: ${quiz.length} → target ${target}`
  );

  const maxRounds =
    profile === "express" || profile === "fast" ? 1 : profile === "balanced" ? 2 : 3;
  for (let round = 0; round < maxRounds && quiz.length < target; round++) {
    const need = target - quiz.length;
    const batch = Math.min(16, Math.max(6, need + 4));
    try {
      const added = await generateAdditionalModuleQuizItems(
        { ...module, quiz },
        batch,
        outputLanguage
      );
      if (added.length === 0) break;

      const seen = new Set(quiz.map((q) => q.question.trim().toLowerCase()));
      const novel = added.filter((q) => {
        const key = q.question.trim().toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (novel.length === 0) break;
      quiz = [...quiz, ...novel];
    } catch (e) {
      console.warn("[study-generation] quiz backfill round failed", e);
      break;
    }
  }

  if (quiz.length < target) {
    console.warn(
      `[study-generation] module ${module.id} quiz backfill incomplete: ${quiz.length}/${target}`
    );
  }

  return { ...module, quiz };
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
  // Default when COURSE_BUILD_PROFILE is unset (e.g. production without the env
  // var): `full` (Sonnet) — the "Full Processing" depth that produces richly
  // structured, pedagogically-titled courses. Set COURSE_BUILD_PROFILE=balanced
  // (Haiku) for cheaper/faster but shallower multi-PDF builds.
  return "full";
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
- Preserve **tables, matrices, and enumerated lists VERBATIM**: reproduce any table (e.g. drug tables with names, dosages, half-lives, MAC values, blood/gas partition coefficients, potency ratios, onset/duration, side-effects, contraindications) as a GitHub-flavored **markdown table** (header row + \`|---|\` separator). Keep every proper noun and every number exactly, in the same row/column. NEVER collapse a table into prose or into category names, and never drop, round, or regroup values. Keep each item under the exact category it appears in, and keep mixed-language terms in full, both languages (e.g. "디아제팜(diazepam)").
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

/**
 * Rough input budget — large PDFs + long outputs often hit limits or timeouts.
 * Raised so `full` builds can ingest a whole lecture deck / chapter without the
 * later pages being truncated away before generation (a major source of
 * "the course skipped half my PDF"). Sonnet's 200k-token context comfortably
 * holds this much source text plus the prompt; `full` is env-overridable below.
 */
const MAX_MATERIAL_CHARS = 240_000;
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
  // full: ingest the whole source by default so no later section is dropped.
  return clampInt(
    envInt("COURSE_FULL_MATERIAL_CHARS", MAX_MATERIAL_CHARS),
    60_000,
    480_000
  );
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
  // full: plan the outline over the WHOLE document (default == module budget)
  // so every section/heading — including the middle and later pages — can be
  // mapped to a module. Capping this low previously omitted the document middle
  // (see `truncateMaterial`), so those topics never became modules/lessons and
  // their content was silently dropped from the course.
  return clampInt(
    envInt("COURSE_FULL_OUTLINE_MATERIAL_CHARS", moduleCap),
    24_000,
    moduleCap
  );
}

const PRESERVE_MARKER_RE =
  /--- (?:TABLES|FIGURES) FROM ORIGINAL PDF[\s\S]*?(?=(?:\n\n--- (?:TABLES|FIGURES) FROM ORIGINAL PDF)|(?:\n\n\[from )|$)/g;
const PIPE_TABLE_RE = /(\|[^\n]+\|\n\|[\s\-:|]+\|(?:\n\|[^\n]+\|)*)/g;
const MD_IMAGE_RE = /!\[[^\]]*\]\([^)]+\)/g;

/**
 * Matches the per-source delimiter emitted by `combinedSourceMarker`
 * (`src/lib/study-ingest/combine.ts`) and by `assembleModuleSourcesFromPlan`
 * below. When a combined multi-source material exceeds the char budget we split
 * on these markers and allocate the budget FAIRLY across sources instead of
 * first-come-first-served, so a long PDF/transcript that follows an image is
 * never silently dropped. Keep the format in sync with `combinedSourceMarker`.
 */
const SOURCE_BLOCK_MARKER_RE =
  /^===== SOURCE \d+\/\d+ — FILE: .+? =====$/gm;

/**
 * Round-robin fair allocation of `bodyBudget` characters across N source bodies:
 * every source gets an equal share; sources that need less donate their slack to
 * sources that need more. Guarantees no single source is starved because another
 * came first. Returns the chars allocated to each body, summing to ≤ bodyBudget.
 */
function allocateBudgetAcrossSources(
  lengths: number[],
  bodyBudget: number
): number[] {
  const alloc = new Array<number>(lengths.length).fill(0);
  let remaining = bodyBudget;
  let active = lengths.map((_, i) => i).filter((i) => lengths[i] > 0);
  while (active.length > 0 && remaining > 0) {
    const share = Math.floor(remaining / active.length);
    if (share <= 0) break;
    const stillActive: number[] = [];
    let used = 0;
    for (const i of active) {
      const want = lengths[i]! - alloc[i]!;
      const give = Math.min(share, want);
      alloc[i]! += give;
      used += give;
      if (alloc[i]! < lengths[i]!) stillActive.push(i);
    }
    if (used === 0) break;
    remaining -= used;
    active = stillActive;
  }
  // Hand any leftover (from flooring) to the still-hungry sources in order so we
  // use the budget fully rather than leaving a few hundred chars on the table.
  for (let i = 0; i < lengths.length && remaining > 0; i++) {
    const want = lengths[i]! - alloc[i]!;
    if (want <= 0) continue;
    const give = Math.min(want, remaining);
    alloc[i]! += give;
    remaining -= give;
  }
  return alloc;
}

/**
 * When `text` is a combination of several labeled sources and exceeds `maxChars`,
 * trim each source to its FAIR share of the budget (see `allocateBudgetAcrossSources`)
 * rather than letting earlier sources consume the whole budget. Each over-budget
 * source is trimmed with the single-source `truncateMaterial` (which still
 * protects tables/figures). Returns null when there are fewer than two source
 * markers (so the caller falls back to the normal single-source path).
 */
function truncateMaterialFairlyAcrossSources(
  text: string,
  maxChars: number
): string | null {
  SOURCE_BLOCK_MARKER_RE.lastIndex = 0;
  const markers: { index: number; line: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = SOURCE_BLOCK_MARKER_RE.exec(text)) !== null) {
    markers.push({ index: m.index, line: m[0] });
  }
  if (markers.length < 2) return null;

  const preamble = text.slice(0, markers[0]!.index).trim();
  const blocks: { marker: string; body: string }[] = [];
  for (let i = 0; i < markers.length; i++) {
    const start = markers[i]!.index;
    const end = i + 1 < markers.length ? markers[i + 1]!.index : text.length;
    const segment = text.slice(start, end);
    const nl = segment.indexOf("\n");
    const marker = (nl >= 0 ? segment.slice(0, nl) : segment).trim();
    const body = (nl >= 0 ? segment.slice(nl + 1) : "").trim();
    blocks.push({ marker, body });
  }

  const markerOverhead =
    blocks.reduce((n, b) => n + b.marker.length + 2, 0) +
    (preamble.length > 0 ? preamble.length + 2 : 0) +
    8;
  const bodyBudget = Math.max(2_000, maxChars - markerOverhead);

  const lengths = blocks.map((b) => b.body.length);
  const totalLen = lengths.reduce((a, c) => a + c, 0);
  if (totalLen <= bodyBudget) {
    // Whole thing fits within budget once overhead is accounted for — keep all.
    const rebuilt = blocks
      .map((b) => `${b.marker}\n${b.body}`)
      .join("\n\n");
    return [preamble, rebuilt].filter((s) => s.length > 0).join("\n\n");
  }

  const alloc = allocateBudgetAcrossSources(lengths, bodyBudget);
  const trimmedBlocks = blocks.map((b, i) => {
    const budget = alloc[i]!;
    const body =
      budget >= b.body.length
        ? b.body
        : truncateMaterial(b.body, Math.max(800, budget));
    return `${b.marker}\n${body}`;
  });
  return [preamble, trimmedBlocks.join("\n\n")]
    .filter((s) => s.length > 0)
    .join("\n\n");
}

/**
 * Never truncate inside PDF table/figure blocks or markdown tables/images —
 * drop prose first (critical for express profile + pharmacology PDFs).
 *
 * For COMBINED multi-source material (several uploaded files), the budget is
 * split fairly per source first, so no modality (e.g. an image placed first)
 * can crowd out another (e.g. a long PDF transcript placed after it).
 */
function truncateMaterial(text: string, maxChars: number = MAX_MATERIAL_CHARS): string {
  const t = text.trim();
  if (t.length <= maxChars) return t;

  const fair = truncateMaterialFairlyAcrossSources(t, maxChars);
  if (fair !== null) return fair;

  const preserved: string[] = [];
  let work = t;

  work = work.replace(PRESERVE_MARKER_RE, (m) => {
    preserved.push(m.trim());
    return `\n\n<<<PRESERVE${preserved.length - 1}>>>\n\n`;
  });

  work = work.replace(PIPE_TABLE_RE, (m) => {
    preserved.push(m.trim());
    return `<<<PRESERVE${preserved.length - 1}>>>`;
  });

  work = work.replace(MD_IMAGE_RE, (m) => {
    preserved.push(m);
    return `<<<PRESERVE${preserved.length - 1}>>>`;
  });

  const preservedJoined = preserved.join("\n\n");
  const proseBudget = Math.max(2_000, maxChars - preservedJoined.length - 120);

  if (work.length > proseBudget) {
    const head = Math.floor(proseBudget * 0.72);
    const tail = proseBudget - head - 80;
    work = `${work.slice(0, head)}\n\n[ … middle of document omitted for processing … ]\n\n${work.slice(-tail)}`;
  }

  let out = work;
  for (let i = 0; i < preserved.length; i++) {
    out = out.replaceAll(`<<<PRESERVE${i}>>>`, preserved[i]!);
  }

  if (out.length > maxChars && preservedJoined.length > 0) {
    return `${preservedJoined}\n\n${work.slice(0, Math.min(proseBudget, 4_000))}`.trim();
  }
  return out.trim();
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

/**
 * Outline-phase coverage (structure planning only — NOT lesson content). The
 * lesson/module CONTENT-generation paths are governed by `lessonGenerationSpec`;
 * this just tells the outliner to map every section/heading to a module/lesson.
 */
function outlineCoverageBlock(profile: CourseBuildProfile): string {
  if (profile === "express") {
    return "COVERAGE: Map **every major section/heading** in the excerpt to its own lesson_title — do not merge unrelated topics. Use enough modules to cover the full deck.";
  }
  if (profile === "fast") {
    return "COVERAGE: Map obvious sections in this excerpt to modules; stay within the caps above.";
  }
  if (profile === "balanced") {
    return "COVERAGE: Cover this excerpt well; use headings to infer structure—keep the outline compact.";
  }
  return `COVERAGE (critical): Plan modules + lesson_titles that together **map every section, heading, and distinct topic across the entire document** — first page to last. The material below is the **full document** unless it is extremely large. Walk it end to end; do not plan only for the opening pages and stop. Later pages and the document middle each need their own modules/lessons. Full lesson bodies are written from the same source later.`;
}

/**
 * GENERAL, course-agnostic rule telling the model to exclude administrative /
 * logistical material (deadlines, schedules, platform/account setup, grading,
 * orientation, "what to do next") and teach only genuine subject matter.
 *
 * Reconciled with the COVERAGE / SOURCE-FIDELITY rules elsewhere: "cover
 * everything" and "do not drop content" apply to **subject-matter** content
 * only — logistics is out of scope by definition, so excluding it is not a
 * fidelity violation. Kept deliberately category-based (no course/school/
 * platform names) so it generalizes to any uploaded document.
 */
function administrativeContentExclusionRules(): string {
  return `SCOPE — TEACH SUBJECT MATTER, NOT COURSE LOGISTICS (critical):
- Teach only the **academic / subject-matter** content of the source: concepts, definitions, theories, principles, methods, processes, named entities, formulas, data, and the worked examples and reasoning that explain them.
- Source documents (syllabi, lecture decks, handouts) also carry **administrative / logistical** material that is NOT subject matter. Treat the following categories as **out of scope** and EXCLUDE them from every module, lesson, title, key term, example, and quiz question:
  • assignment / homework / problem-set instructions and **due dates**;
  • exam / quiz / test **dates, schedules, locations, durations, or formats**;
  • signing up for, logging into, installing, or **paying for** a platform, tool, app, code, or account, and instructions on how/where to access readings or materials;
  • grading policy, point weighting, late penalties, attendance, or academic-integrity rules;
  • office hours, contact details, instructor/TA/staff lists, and course-orientation logistics;
  • calendar / agenda / housekeeping slides and "getting started", "what to do next", "looking ahead", "preparing for next class/lecture", or recap-of-logistics content.
- If an **entire** section, slide, or chunk is purely administrative/logistical, do NOT create a module, lesson, or title for it — skip it.
- If a section is mostly subject matter with an **incidental** logistical aside (e.g. one line giving a due date inside an otherwise substantive slide), drop the aside and teach only the subject matter.
- This exclusion takes precedence over coverage/completeness: never keep logistics just to fill a planned title, and never invent subject matter to replace excluded logistics.`;
}

/**
 * GOVERNING lesson-generation spec — the single source of truth for how the
 * model converts source material into lessons (coverage, what to keep/drop,
 * worked-example-vs-activity, fidelity, and the per-lesson output). Injected
 * into EVERY content-generation path (per-module/expand and monolith) so
 * behavior is uniform and global (no per-course/subject special casing).
 *
 * This SUPERSEDES the former `sourceCoverageRules` (module/monolith),
 * `sourceFidelityRules`, and `administrativeContentExclusionRules` prose in the
 * content paths. The verbatim spec already mandates dropping logistics and
 * not inventing; the only adaptations are (1) binding OUTPUT to the lesson JSON
 * fields the app consumes and (2) folding the table/figure fidelity instruction
 * into the FIDELITY section (detailed table mechanics follow via
 * `tableAndDataFidelityRules`).
 */
function lessonGenerationSpec(): string {
  return `You convert source teaching material into self-contained study lessons. The source may be slides, a lecture transcript, a textbook page, an article, or a mix. Your job is to preserve everything teachable in the source and expand it into prose a student can learn from WITHOUT the original.

COVERAGE — the core rule:
Every concept, distinction, mechanism, worked example, named entity, framework, and cause→effect explanation in the source must appear in the lessons. Do not drop material because it is hard to phrase, buried in a messy transcript, or only stated once. If the source teaches it, the lesson keeps it.

Treat ALL sources as equal in weight. A rambling spoken transcript carries as much teachable content as a clean slide — often more. Do NOT favor neatly formatted sources over messy ones. The connective reasoning a lecturer says out loud is usually the most valuable content and the easiest to lose. Mine every source as hard as the cleanest one.

WHAT TO KEEP:
- definitions and the distinctions between similar terms
- step-by-step methods, procedures, and frameworks, in their order
- worked examples and the reasoning inside them, with their actual details — not just the conclusion
- the specific named people, organizations, cases, and examples the source uses; do not replace a specific case with a generic stand-in
- consequences, stakes, and "why it matters" reasoning
- interpretive skills the source teaches

WHAT TO DROP:
- pure logistics: deadlines, sign-up steps, platform names, dates, staff names, where to submit etc
- in-source self-check questions and "now you try" activity prompts — the downstream system generates its own practice items
- filler the source itself flags as skippable

WORKED EXAMPLE vs ACTIVITY:
A worked example (the source shows the reasoning and its result) is teaching content → keep and explain it fully. An activity (a prompt for the student to attempt) → drop it, but keep any concept it was testing. A solved item is exposition; an unsolved prompt is an exercise.

FIDELITY — do not invent:
- Use ONLY what the source supports. Never add facts, figures, examples, or claims not present in or directly implied by the source.
- Reproduce the source faithfully even if you believe it contains an error. Do not silently correct it.
- Reproduce every table, chart, and structured data block the source contains faithfully — as complete GitHub-flavored markdown tables (one row per source row, every column header, every number and proper noun exactly, mixed-language terms in full). Never collapse a table into prose. Leave any markdown image/figure embeds the pipeline injects untouched. (Detailed table mechanics follow below.)
- If a section of source is thin, write a proportionally short lesson. Never pad to hit a length.

OUTPUT per lesson — map onto the lesson JSON object the system consumes:
- "title": a title naming the concept.
- "content" (REQUIRED — never empty): connected teaching prose that fully explains the concept(s) in complete sentences, including any worked examples with their actual details and any source tables reproduced as markdown. EVERY lesson must teach something in prose: a real lesson body a student can learn from. NEVER emit a lesson whose body is empty, whitespace, a bare title, or "key terms only" — a lesson that only lists key_terms (or only a table) with no explanatory prose is INVALID. If a section is thin, write a proportionally short body, but it must still explain the idea in real sentences.
- "key_terms" (DISCRETIONARY — no fixed count; judge from the source): an array of { "term", "definition" } objects. Include a key term ONLY when it is a distinct, important term the source introduces and defines or uses meaningfully. Add as many as the material genuinely warrants — that may be ZERO for a lesson with no notable terminology, or many for a terminology-dense lesson. The model decides which terms are genuinely worth learning. Do NOT pad with trivial or common words, do NOT hit a quota, and never invent terms not grounded in the source. An empty key_terms array is valid and is preferred over filler.
- "examples": only examples grounded in the source. Use the source's own specific example where it gives one. Where the source gives none, output an empty array (or omit the field) — never a placeholder string and never an invented scenario.

Before finishing, check each distinct teachable point in the source against your lessons. If anything in the source isn't covered, add it. Also confirm every lesson's "content" is real teaching prose, not an empty or key-terms-only body.`;
}

/**
 * Detailed table / structured-data mechanics that back the FIDELITY bullet in
 * `lessonGenerationSpec`. Forces the model to carry source tables / enumerated
 * data into the lesson body verbatim instead of summarizing them into prose.
 * Critical for technical material (e.g. pharmacology drug tables) where the
 * table IS the highest-value, most testable content.
 */
function structuredDataFidelityRules(): string {
  return `STRUCTURED DATA FIDELITY (critical — full tables, not summaries):
- Every table, drug list, potency chart, side-effect matrix, seizure-type mapping, and numbered reference grid from the source MUST appear in lesson "content" as **complete GitHub-flavored markdown tables** (header row + \`|---|\` separator + **one row per source row**). Do NOT summarize tables into prose-only bullets.
- Prose may explain mechanisms and concepts; **tables carry the verbatim reference data** students must memorize (drug names, doses, half-lives, MAC values, potency ratios, side-effects, contraindications, etc.).
- Include **every row** from 표 N tables — never drop entries (e.g. if the source lists 페티딘, 펜타조신, 부프레노르핀, they must appear in a table row, not only morphine/fentanyl in prose).
- Blocks marked \`--- TABLE DATA FROM PDF ---\` contain authoritative table markdown — **copy them into the matching lesson "content"** (add a short heading like \`### 표 3-14\` above each when the slide label is known). Do not leave them only in the material block.
- Do NOT use {{asset:...}} tokens for tables — students read markdown tables in the lesson body. Leave any markdown image/figure embeds the pipeline injects untouched (do not relabel or remove them).
- Preserve every proper noun and NUMBER exactly. Do not round, omit, merge rows, or regroup values.
- Keep mixed-language terms in full, BOTH languages, exactly as written (e.g. "디아제팜(diazepam)").
- **NUMERIC RANGES**: always write ranges with an en-dash between endpoints: 1–4, 2–3, 10–18, 47–100. NEVER concatenate endpoints (wrong: 14단계, 23시간, 1018시간, 47100시간).`;
}

/**
 * Injected into lesson-generating prompts (module + monolith). Forces the
 * model to carry source tables / enumerated data into the lesson body
 * verbatim instead of summarizing them into prose. Critical for technical
 * material (e.g. pharmacology drug tables) where the table IS the
 * highest-value, most testable content.
 */
function factualAccuracyRules(): string {
  return `FACTUAL ACCURACY (critical — no confabulation):
- Use **only** drug names, spellings, and romanizations that appear in the source material. Do NOT invent English names (wrong: "Fluoxamine" — use 플루복사민(fluvoxamine) exactly as in the PDF).
- **key_terms**: each "term" and its "definition" MUST describe the **same concept**. Never pair a label with an unrelated mechanism (wrong: term "뇌전증지속상태" with a Parkinson's dopamine definition).
- Preserve source anatomical terms exactly (e.g. 숨뇌마비기 medullary paralysis — do not substitute other nerve names).
- Do NOT paste low-quality or garbled markdown tables from the material if cells look like OCR noise; omit them rather than include unreadable grids.
- Do NOT invent specific numeric doses (mg, μg, mcg, g, mL, units) in examples unless that exact dose appears in the source — use qualitative phrasing ("low dose", "typical analgesic dose") instead of made-up numbers.
- Cover numbered figures/topics from the source when present (e.g. 중추 도파민 4경로 in schizophrenia / antipsychotic lessons).
- Preserve **2-column labeled comparison tables** exactly (e.g. \`양성증상 | 음성증상\`, drug | mechanism). Never flatten labeled columns into unlabeled bullet runs or comma lists that lose the column headers.
- When describing a **named drug or anesthetic agent**, use **only** facts from that agent's **own row** in the source table. Never attribute footnotes, MAC-column notes, or properties from **adjacent rows** (e.g. N₂O / 아산화질소, generic MAC footnotes) to a different agent (e.g. sevoflurane / 세보플루레인).
- Do **not** invent table columns or rows not present in the source. If the source table has **N** columns, output exactly **N** columns with the same headers — never add invented columns such as "임상적 의미" unless the PDF includes them.`;
}

function voiceRules(): string {
  return `VOICE (strict):
- Write in a declarative, instructional tone. Never use conversational asides, first-person hedging, or self-referential commentary about your own reasoning or uncertainty (e.g. no "Wait—this doesn't balance", "hmm", "let me reconsider", "as an AI", "it seems").
- Never flag your own doubt inside the lesson text. If content is uncertain, leave it out; do not narrate the uncertainty to the student.
- The page already carries an "AI-generated content may contain mistakes" disclaimer, so fidelity to source is the priority — not autonomous correctness-seeking.`;
}

function quantitativeTeachingRules(): string {
  return `QUANTITATIVE WORKED EXAMPLES (reproduce — do not compute or correct):
- Reproduce every balance sheet, income statement, journal entry, and numeric walkthrough **exactly as the source presents it**, including the source's own totals and framing. Do NOT recompute, "verify", or correct the source's numbers — even one you believe is wrong.
- Do NOT build a computed table, total, or balance the source never stated. If the source does not work a calculation through, do not work it through for the student.
- Keep each source figure with the label the source gave it. If the source says "60% markup", do not relabel it "gross margin" (and vice versa); never re-derive a different value to make a label "correct".
- Journal-entry step headings must name the **same debit/credit side** the source's entry lines use (if the source debits Sales, the heading reads "Debit Sales…"). Reproduce the source's pairing; do not reinterpret it.
- Never narrate an arithmetic check, discrepancy, or fix inside the lesson (no "this doesn't balance", no inventing a reason like "we haven't recorded depreciation" to explain a gap). Present the source's figures as given, without commentary.`;
}

/**
 * Table / numeric / voice fidelity that supports the governing
 * `lessonGenerationSpec` in the CONTENT-generation paths. Kept deliberately
 * separate from the spec so the table/figure-reproduction capability survives.
 * (The former `dataFidelityRules` also embedded `administrativeContentExclusionRules`
 * and `sourceFidelityRules`; both are now SUPERSEDED by `lessonGenerationSpec`'s
 * WHAT-TO-DROP / FIDELITY sections and are no longer injected into content paths.)
 */
function tableAndDataFidelityRules(): string {
  return `${structuredDataFidelityRules()}

${factualAccuracyRules()}

${quantitativeTeachingRules()}`;
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
  profile: CourseBuildProfile,
  outputLanguage: CourseOutputLanguage = DEFAULT_COURSE_OUTPUT_LANGUAGE,
  studyContext?: string
): string {
  let sizeRules: string;
  let quizFooter: string;

  const quizTarget = moduleQuizTarget(profile);
  const frMin = moduleFreeResponseMin(profile, quizTarget);

  if (profile === "full") {
    sizeRules = `Rules for output size (important): use **at least 5 modules and up to 14** unless the source is extremely short — split the material into many focused modules so each major topic gets its own. Keep each lesson "content" thorough but under roughly 1000 words so the full answer fits in one response. Every module must include at least one lesson.

QUIZ (critical): Each module needs a rich practice set — **at least ${quizTarget} questions per module**, with **at least ${frMin} items** whose type is free_response (short written answer). The rest should be mcq. Aim for roughly half MCQ and half free-response overall. MCQs must have exactly 4 choices. Every free_response **must** include **reference_answer** (snake_case, non-empty, several sentences of rubric — key ideas and acceptable points).`;
    quizFooter =
      `Include many quiz objects per module (minimum ${quizTarget} total per module, including ≥${frMin} free_response). Do not omit free_response types — they are required. Only return valid JSON. No markdown fences, no extra text. Base everything strictly on the uploaded material — do not add outside information.`;
  } else if (profile === "express") {
    sizeRules = `Rules for output size (critical for speed): use **2 or 3** modules only. At most **3 lessons per module**. Each lesson "content" must be **under 500 words** — clear and complete for its planned scope, not a textbook.

QUIZ (critical): Each module needs **at least ${quizTarget} questions**, with **at least ${frMin}** type free_response (reference_answer required). The rest MCQ with exactly 4 choices.`;
    quizFooter =
      `Meet the minimums above (≥${quizTarget} quiz items per module, including ≥${frMin} free_response). Only return valid JSON. No markdown fences, no extra text. Base everything on the uploaded material.`;
  } else if (profile === "fast") {
    sizeRules = `Rules for output size (important): use at least 2 modules and at most 4 unless the source is extremely short. Keep each lesson "content" clear and instructive but under roughly 500 words. Every module must include at least one lesson.

QUIZ (critical): Each module needs a practical practice set — **at least ${quizTarget} questions per module**, with **at least ${frMin} items** whose type is free_response (short written answer). The rest should be mcq. MCQs must have exactly 4 choices. Every free_response **must** include **reference_answer** (snake_case, non-empty, concise rubric).`;
    quizFooter =
      `Include enough quiz objects per module to meet the minimums above (≥${quizTarget} total, ≥${frMin} free_response). Do not omit free_response types — they are required. Only return valid JSON. No markdown fences, no extra text. Base everything strictly on the uploaded material — do not add outside information.`;
  } else if (profile === "balanced") {
    const maxBalMods = clampInt(envInt("COURSE_BALANCED_MAX_MODULES", 3), 2, 6);
    sizeRules = `Rules for output size (important): use at least 2 modules and at most ${maxBalMods} unless the source is extremely short. Keep each lesson "content" clear; aim under roughly 500 words per lesson. Every module must include at least one lesson.

QUIZ (critical): Each module needs **at least ${quizTarget} questions per module**, with **at least ${frMin}** type free_response (short written answer). The rest should be mcq. MCQs must have exactly 4 choices. Every free_response **must** include **reference_answer** (snake_case, non-empty, concise rubric).`;
    quizFooter =
      `Include enough quiz objects per module to meet the minimums above (≥${quizTarget} total, ≥${frMin} free_response). Do not omit free_response types — they are required. Only return valid JSON. No markdown fences, no extra text. Base everything strictly on the uploaded material — do not add outside information.`;
  } else {
    const _bad: never = profile;
    throw new Error(`Unhandled course build profile: ${String(_bad)}`);
  }

  return `You are an expert course designer and educator. You have been given raw course material (lecture slides, syllabi, notes). Your job is NOT to summarize this material. Your job is to use it as a source to BUILD a complete, professional, structured course that a student would genuinely pay for.
${generationContextSuffix(studyContext, outputLanguage)}
${sizeRules}

${titleStyleRules()}

${lessonGenerationSpec()}

${tableAndDataFidelityRules()}

${voiceRules()}

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
          "title": "title naming the concept",
          "content": "REQUIRED non-empty teaching prose that fully teaches the concept(s) from the source, including any worked examples with their actual details — and when the source has a table or list of data, INCLUDE it as a markdown table (do not turn it into prose). Never empty, never key-terms-only.",
          "key_terms": [{"term": "word", "definition": "definition"}],
          "examples": ["only examples grounded in the source — empty array if the source gives none; never a placeholder or invented scenario"]
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
  const stopReason = (finalMessage as { stop_reason?: string }).stop_reason;
  if (stopReason === "max_tokens") {
    console.warn("[study-generation] PDF ingest stream hit max_tokens", {
      max_tokens: params.max_tokens,
    });
  }
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
  materialText: string,
  options?: {
    outputLanguage?: CourseOutputLanguage;
    studyContext?: string;
  }
): Promise<CoursePayload> {
  const outputLanguage =
    options?.outputLanguage ?? DEFAULT_COURSE_OUTPUT_LANGUAGE;
  const studyContext = options?.studyContext;
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
  const instruction = courseInstruction(
    trimmed,
    profile,
    outputLanguage,
    studyContext
  );

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
      const repaired = await repairPayloadJson(anthropic, rawText, profile);
      const modules = await finalizeGeneratedModules(
        anthropic,
        repaired.modules,
        profile,
        trimmed,
        outputLanguage
      );
      return { ...repaired, modules };
    } catch (e) {
      console.error(e);
      throw new Error("Claude did not return valid JSON");
    }
  }

  try {
    const payload = parseCoursePayload(parsed);
    const modules = await finalizeGeneratedModules(
      anthropic,
      payload.modules,
      profile,
      trimmed,
      outputLanguage
    );
    return { ...payload, modules };
  } catch (e) {
    console.warn("[study-generation] Payload validation failed; repairing", e);
    try {
      const repaired = await repairPayloadJson(anthropic, rawText, profile);
      const modules = await finalizeGeneratedModules(
        anthropic,
        repaired.modules,
        profile,
        trimmed,
        outputLanguage
      );
      return { ...repaired, modules };
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
  return clampInt(envInt("COURSE_FULL_OUTLINE_MAX_TOKENS", 12_288), 4096, 16_384);
}

function selfStudyBlock(studyContext: string): string {
  const block = formatSelfStudyGenerationBlock(studyContext);
  return block ? `\n${block}\n` : "";
}

function generationContextSuffix(
  studyContext?: string,
  outputLanguage: CourseOutputLanguage = DEFAULT_COURSE_OUTPUT_LANGUAGE
): string {
  const parts = [formatOutputLanguageGenerationBlock(outputLanguage)];
  if (studyContext) {
    const block = selfStudyBlock(studyContext);
    if (block.trim()) parts.push(block.trim());
  }
  return `\n${parts.join("\n\n")}\n`;
}

function outlineInstruction(
  materialText: string,
  profile: CourseBuildProfile,
  studyContext?: string,
  outputLanguage: CourseOutputLanguage = DEFAULT_COURSE_OUTPUT_LANGUAGE
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
    const maxModules = clampInt(envInt("COURSE_FULL_MAX_MODULES", 18), 4, 24);
    moduleCount = `Use **at least 5** and up to **${maxModules}** modules, and **scale the number to the size of the source**: a short handout may need only 5–6, but a long lecture deck, chapter, or multi-topic document should use many more (toward the maximum). Split the material into focused modules so each major topic, section, or learning objective gets its own module — prefer MORE, narrower modules over a few broad ones. Do NOT compress later pages into one catch-all module; every distinct section of the document, from first page to last, must be represented.`;
    maxLessonTitles = clampInt(envInt("COURSE_FULL_MAX_LESSON_TITLES", 12), 3, 20);
  }

  return `You are an expert course designer. From the material below, output ONLY a compact JSON **outline** (no full lesson bodies, no quiz questions).
${generationContextSuffix(studyContext, outputLanguage)}
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

${administrativeContentExclusionRules()}

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

NEVER use slide chrome or administrative headings as a module or lesson title. Titles like "Warm Up", "Aktiv Warm Up", "Test Your Understanding", "Understanding Check", "Agenda", "Objectives", "Learning Outcomes", "Recap", "Review", "Clicker Question", "Poll", "Discussion", "Announcements", "Today's Plan", or a bare slide/page number are NOT topics. Replace each with the actual academic concept that slide teaches (e.g. a "Test Your Understanding" slide about gas laws becomes "Applying the Ideal Gas Law"). The title must name what the student learns, not the slide's role in the deck.

Repetition rule: across the whole outline, no two modules (or two lesson titles) may start with the same first word. If you'd produce "Master the X" and "Master the Y", rewrite both as bare topic names.`;
}

/** Quiz count requested in the module JSON (kept small so tables + lessons fit). */
function moduleQuizMinForGeneration(profile: CourseBuildProfile): number {
  const target = moduleQuizTarget(profile);
  if (profile === "express") return Math.min(3, target);
  if (profile === "fast") return Math.min(4, target);
  return Math.min(5, target);
}

function moduleQuizRules(profile: CourseBuildProfile): string {
  const genMin = moduleQuizMinForGeneration(profile);
  const frMin = moduleFreeResponseMin(profile, genMin);
  return `QUIZ (this module only): **at least ${genMin}** questions for now (with **at least ${frMin}** type free_response, reference_answer required). The rest MCQ with exactly 4 choices each. Do not shrink lesson content to fit more quiz items — additional questions are added server-side later.`;
}

function looksLikeTruncatedJson(text: string): boolean {
  const t = stripJsonFence(text).trim();
  if (t.length < 8) return true;
  if (!t.startsWith("{")) return true;
  if (!t.endsWith("}")) return true;
  try {
    JSON.parse(t);
    return false;
  } catch {
    return true;
  }
}

function moduleInstruction(
  materialText: string,
  outline: CourseOutlinePayload,
  moduleIndex: number,
  profile: CourseBuildProfile,
  studyContext?: string,
  outputLanguage: CourseOutputLanguage = DEFAULT_COURSE_OUTPUT_LANGUAGE,
  assetManifestBlock?: string
): string {
  const stub = outline.modules[moduleIndex];
  const n = outline.modules.length;
  const titles = stub.lesson_titles.map((t) => JSON.stringify(t)).join(", ");
  // June-1 title behavior: the outline/structure-plan already produced the
  // module + lesson titles, so the module writer must KEEP them verbatim
  // (same count, same order) rather than re-deriving "descriptive" titles.
  const moduleTitleDirective = `Module title **must be** ${JSON.stringify(stub.title)}.`;
  const lessonTitleDirective = `Use the planned lesson titles below **exactly as given**, in the SAME order and SAME count — one full lesson per planned title. Do not rename, merge, split, or reorder them.`;
  const wrapperTitle = JSON.stringify(stub.title);
  const styleRule =
    profile === "express"
      ? `STYLE (express): Focused lessons (**under ~500 words** each). Cover every planned topic from the source — do not skip subtopics assigned to this module.`
      : profile === "fast"
        ? `STYLE (fast): Write clearly with enough detail to teach (use examples, connect ideas), but avoid unnecessary fluff.`
        : profile === "balanced"
          ? `STYLE (balanced): Teach clearly with examples; aim **under ~500 words** per lesson.`
          : "";

  return `You are expanding **one module** of a structured course (${moduleIndex + 1} of ${n}). Course title: ${JSON.stringify(outline.title)}. Module id **must be** ${stub.id}. ${moduleTitleDirective}
${generationContextSuffix(studyContext, outputLanguage)}
Create one full module object: lessons (one per planned lesson title below, in order — same count as lesson_titles, each with "content", "key_terms", and "examples" per the spec below), plus quiz.

Planned lesson titles for this module: ${titles}.
${lessonTitleDirective}

${lessonGenerationSpec()}

${styleRule}

${tableAndDataFidelityRules()}

${voiceRules()}

${assetManifestBlock?.trim() ? `${assetManifestBlock.trim()}\n\n` : ""}${moduleQuizRules(profile)}

Return ONLY valid JSON in this exact wrapper (no markdown):
{ "module": { "id": ${stub.id}, "title": ${wrapperTitle}, "lessons": [...], "quiz": [...] } }

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
  const requirements = `Requirements for EACH lesson: "content" MUST be non-empty teaching prose grounded in the source (never empty, never a bare title, never "key terms only"). "key_terms" are DISCRETIONARY (term+definition) — include only genuinely important terms the source defines; an empty key_terms array is valid, and you must not invent terms or pad to a count. "examples" must be grounded in the source; if the source gives none, use an empty array (never a placeholder string).`;

  const prompt = `You returned JSON that could not be parsed or did not meet requirements for a single course "module" (id, title, lessons[], quiz[]). Output ONLY: { "module": { ... } } with valid JSON. No markdown.

${requirements}

${moduleQuizRules(profile)}

Broken output (repair):
${brokenAssistantText.slice(0, 100_000)}`;

  const repairBudgets =
    profile === "express"
      ? [12_288, 20_480]
      : profile === "fast"
        ? [16_384, 24_576]
        : profile === "balanced"
          ? [20_480, 30_720]
          : [24_576, 32_768];

  let lastText = "";
  for (const moduleRepairMax of repairBudgets) {
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
    lastText = text;
    try {
      const parsed = JSON.parse(stripJsonFence(text)) as Record<string, unknown>;
      const mod = parsed.module;
      return parseCourseModuleLoose(mod);
    } catch {
      if (!looksLikeTruncatedJson(text)) {
        // Malformed but complete — one more budget may not help; still try.
        continue;
      }
    }
  }

  console.warn("[study-generation] module repair exhausted", {
    tail: lastText.slice(-400),
  });
  throw new Error("Claude did not return valid JSON after module repair");
}

/**
 * A lesson body must be real teaching prose. Treat an empty / whitespace /
 * near-empty body (a bare title, or a "key terms only" lesson) as MISSING
 * content — these get repaired. A genuine short explanation or a real markdown
 * table is NOT empty (a table carries teachable data). This guards the bug
 * where a lesson rendered with key_terms but no lesson body.
 */
function lessonContentIsEmpty(content: string | undefined): boolean {
  const t = (content ?? "").replace(/\s+/g, " ").trim();
  return t.length < 24;
}

function moduleNeedsLessonContent(m: CourseModule): boolean {
  return m.lessons.some((l) => lessonContentIsEmpty(l.content));
}

/**
 * Second pass: the model produced a lesson with a title (and possibly
 * key_terms) but an EMPTY / near-empty "content" body. Re-prompt with the
 * SOURCE so it writes the missing lesson BODIES as real teaching prose (not
 * just a glossary). Other lessons, titles, key_terms, examples, and quiz are
 * preserved. key_terms stay DISCRETIONARY — no count is forced.
 */
async function repairModuleMissingLessonContent(
  anthropic: Anthropic,
  module: CourseModule,
  profile: CourseBuildProfile,
  sourceExcerpt: string,
  outputLanguage: CourseOutputLanguage
): Promise<CourseModule> {
  const emptyTitles = module.lessons
    .filter((l) => lessonContentIsEmpty(l.content))
    .map((l) => l.title);
  if (emptyTitles.length === 0) return module;

  const payload = JSON.stringify({ module });
  const clippedModule =
    payload.length > 60_000 ? `${payload.slice(0, 60_000)}\n…(truncated)` : payload;
  const sourceForRepair = truncateMaterial(
    sourceExcerpt,
    Math.min(materialCharLimit(profile), 60_000)
  );

  const prompt = `One or more lessons in this course "module" have an EMPTY or near-empty "content" body — that is invalid. Every lesson must teach in real prose. Using ONLY the source material below, WRITE the missing lesson bodies.
${generationContextSuffix(undefined, outputLanguage)}
Lessons needing a real "content" body (by title): ${emptyTitles
    .map((t) => JSON.stringify(t))
    .join(", ")}.

Rules:
- Return ONLY valid JSON: { "module": { ... } } with the SAME module id, module title, lesson titles (same order and count), and quiz.
- For every lesson, "content" MUST be non-empty teaching prose grounded in the source — complete sentences a student can learn from, including any worked examples with their details and any source tables reproduced as markdown. NEVER a bare title, an empty string, or a "key terms only" body.
- Keep lessons that already have a real body essentially unchanged.
- "key_terms" are DISCRETIONARY: keep only genuinely important terms the source defines; an empty key_terms array is valid. Do not invent terms or pad to a count.
- "examples" must be grounded in the source; where the source gives none, use an empty array (never a placeholder or invented scenario).
- Use snake_case keys ("key_terms", "examples"). Base everything strictly on the source; add no outside information.

CURRENT MODULE JSON:
${clippedModule}

--- SOURCE MATERIAL START ---
${sourceForRepair}
--- SOURCE MATERIAL END ---`;

  const contentRepairMax =
    profile === "express"
      ? 10_240
      : profile === "fast"
        ? 12_288
        : profile === "balanced"
          ? 16_384
          : 24_576;

  const msg = await createMessageWithRetries(
    anthropic,
    {
      model: resolveCourseModel(profile),
      max_tokens: contentRepairMax,
      temperature: 0.2,
      messages: [{ role: "user", content: prompt }],
    },
    {
      maxAttempts:
        profile === "express" || profile === "fast"
          ? 1
          : profile === "balanced"
            ? 2
            : 3,
    }
  );

  const text = extractTextBlock(msg);
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFence(text));
  } catch {
    throw new Error(
      "Claude did not return valid JSON after lesson-content repair"
    );
  }
  const obj = parsed as Record<string, unknown>;
  return parseCourseModuleLoose(obj.module);
}

/**
 * Drop any lesson that STILL has an empty body after repair so the app never
 * renders a content-less lesson. Never empties a module: if EVERY lesson is
 * empty (degenerate), keep them so the module still has its planned structure.
 */
function dropContentlessLessons(module: CourseModule): CourseModule {
  const kept = module.lessons.filter((l) => !lessonContentIsEmpty(l.content));
  if (kept.length === 0 || kept.length === module.lessons.length) return module;
  return { ...module, lessons: kept };
}

/**
 * Ensure every lesson in a module has a real prose body. Runs for ALL profiles
 * — an empty lesson body is a correctness bug, not a depth setting. Attempts a
 * source-grounded content repair, then drops any lesson still empty.
 *
 * key_terms are intentionally NOT forced here: they are discretionary and an
 * empty key_terms array is valid (BUG 2).
 */
async function ensureModuleLessonFields(
  anthropic: Anthropic,
  module: CourseModule,
  profile: CourseBuildProfile,
  sourceExcerpt: string,
  outputLanguage: CourseOutputLanguage
): Promise<CourseModule> {
  if (!moduleNeedsLessonContent(module)) return module;

  const maxRepairs = profile === "express" || profile === "fast" ? 1 : 2;
  let out = module;
  for (let i = 0; i < maxRepairs && moduleNeedsLessonContent(out); i++) {
    try {
      out = await repairModuleMissingLessonContent(
        anthropic,
        out,
        profile,
        sourceExcerpt,
        outputLanguage
      );
    } catch (e) {
      console.warn(
        `[study-generation] module ${module.id} lesson-content repair failed`,
        e
      );
      break;
    }
  }
  return dropContentlessLessons(out);
}

// ────────────────────────────────────────────────────────────────────────
// Content-driven structure planning (feature flag STRUCTURE_PLANNING).
// One Claude call groups extracted chunks into modules/lessons regardless of
// file boundaries. Input is chunk summaries only (no full text) to save tokens.
// ────────────────────────────────────────────────────────────────────────

function structurePlanInstruction(
  chunkSummaries: IngestChunkSummary[],
  targets: StructurePlanTargets,
  studyContext?: string,
  outputLanguage: CourseOutputLanguage = DEFAULT_COURSE_OUTPUT_LANGUAGE,
  replanReason?: string
): string {
  const chunkJson = JSON.stringify(chunkSummaries, null, 0);
  const replanBlock =
    replanReason && replanReason.trim().length > 0
      ? `\nPREVIOUS PLAN REJECTED (fix this):\n${replanReason.trim()}\n`
      : "";
  return `You are an expert course architect. You are given a list of CONTENT CHUNKS extracted from one or more uploaded files. Group them into a coherent course structure based on the CONTENT, not on which file they came from.
${replanBlock}
CRITICAL GROUPING RULES:
- File boundaries do NOT equal lesson boundaries.
- A single lesson MAY span multiple files (e.g. "Lecture 3 Part 1", "Part 2", "Part 3" almost certainly belong to the same lesson or module).
- One file MAY contain multiple lessons (a long PDF with several chapters/sections becomes several lessons).
- Some files/chunks may be SUPPLEMENTARY to a lesson (examples, appendices, problem sets) rather than their own lesson — attach them to the most relevant lesson instead of giving them a standalone lesson.
- Decide grouping using: chunk titles/headings, topic continuity, chunk length (approxChars), and filename patterns (e.g. "Part 1/2/3", "Week N", "Chapter N").
${generationContextSuffix(studyContext, outputLanguage)}
${structurePlanCoveragePromptBlock(targets)}

${administrativeContentExclusionRules()}
- Every chunk id must still be assigned to exactly one lesson for coverage, so when a chunk is purely administrative/logistical, attach it to the nearest subject-matter lesson as a supplementary chunk; the later writing step will exclude its logistics. Do NOT give a purely-logistical chunk its own lesson or module.

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
    return clampInt(envInt("COURSE_PLAN_MAX_TOKENS", 4096), 2048, 6144);
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
function isLlmStructurePlanningEnabled(): boolean {
  // Default ON: let Claude group chunks into coherent, pedagogically-named
  // modules/lessons (the "Full Processing" structure). When off, the
  // deterministic fallback maps one file → one module with raw slide headings
  // as lesson titles. Set STRUCTURE_PLANNING_LLM=0 to force that fallback.
  return process.env.STRUCTURE_PLANNING_LLM?.trim() !== "0";
}

function normalizeChunkSummariesForPlanner(
  chunkSummaries: IngestChunkSummary[]
): IngestChunkSummary[] {
  return chunkSummaries.map((c, i) => {
    let title = normalizeIngestDisplayTitle(c.title);
    if (isBadIngestTitle(title)) {
      const page = c.position.match(/\bpage\s+(\d+)/i);
      const slide = c.position.match(/\bslide\s+(\d+)/i);
      title = page
        ? `Page ${page[1]}`
        : slide
          ? `Slide ${slide[1]}`
          : `Part ${i + 1}`;
    }
    return { ...c, title };
  });
}

export async function planCourseStructureFromChunks(
  chunkSummaries: IngestChunkSummary[],
  streamSink?: PdfIngestStreamSink,
  studyContext?: string,
  outputLanguage: CourseOutputLanguage = DEFAULT_COURSE_OUTPUT_LANGUAGE
): Promise<CourseStructurePlan> {
  if (chunkSummaries.length === 0) {
    throw new Error("No chunks to plan a course structure from");
  }

  const profile = resolveCourseBuildProfile();
  const normalizedSummaries = normalizeChunkSummariesForPlanner(chunkSummaries);

  if (!isLlmStructurePlanningEnabled()) {
    console.info("[study-generation] deterministic structure plan", {
      chunks: normalizedSummaries.length,
    });
    return normalizeStructurePlanTitles(
      buildDeterministicStructurePlan(normalizedSummaries, profile)
    );
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY");
  }
  const anthropic = new Anthropic({
    apiKey,
    timeout: getPdfAnthropicTimeoutMs(),
    maxRetries: 0,
  });

  const targets = structurePlanTargets(chunkSummaries.length, profile);
  const planAttempts =
    profile === "express" || profile === "fast" ? 2 : 3;
  let lastCoverageError: string | null = null;

  for (let attempt = 0; attempt < planAttempts; attempt++) {
    const instruction = structurePlanInstruction(
      normalizedSummaries,
      targets,
      studyContext,
      outputLanguage,
      attempt > 0 ? (lastCoverageError ?? undefined) : undefined
    );

    const rawText = await invokeUserMessageForPdfText(
      anthropic,
      {
        model: resolveOutlineModel(profile),
        max_tokens: planMaxTokens(profile),
        temperature: attempt === 0 ? 0.12 : 0.08,
        messages: [{ role: "user", content: instruction }],
      },
      streamSink,
      1,
      OUTLINE_BUDGET_WAIT_MS
    );

    let plan: CourseStructurePlan;
    try {
      const parsed: unknown = JSON.parse(stripJsonFence(rawText));
      plan = parseCourseStructurePlan(parsed);
    } catch {
      try {
        plan = await repairStructurePlanJson(anthropic, rawText, profile);
      } catch (e) {
        console.warn("[study-generation] plan parse/repair failed", e);
        lastCoverageError = "Response was not valid JSON for a structure plan.";
        continue;
      }
    }

    const coverageError = validateStructurePlanCoverage(
      plan,
      normalizedSummaries,
      targets
    );
    if (!coverageError) {
      if (attempt > 0) {
        console.info("[study-generation] structure plan ok after replan", {
          attempt: attempt + 1,
          lessons: plan.modules.reduce((n, m) => n + m.lessons.length, 0),
          modules: plan.modules.length,
        });
      }
      return normalizeStructurePlanTitles(plan);
    }

    lastCoverageError = coverageError;
    console.warn("[study-generation] structure plan coverage rejected", {
      attempt: attempt + 1,
      reason: coverageError,
    });
  }

  console.warn(
    "[study-generation] using deterministic structure plan (full chunk coverage)",
    { chunks: chunkSummaries.length, lastError: lastCoverageError }
  );
  return normalizeStructurePlanTitles(
    buildDeterministicStructurePlan(normalizedSummaries, profile)
  );
}

/** Convert a structure plan into the existing outline shape (expand/finalize unchanged). */
export function structurePlanToOutline(
  plan: CourseStructurePlan,
  options?: StructurePlanTitleOptions
): CourseOutlinePayload {
  const normalized = normalizeStructurePlanTitles(plan, options);
  const modules = normalized.modules.map((m, i) => ({
    id: i + 1,
    title: normalizeIngestDisplayTitle(m.title),
    lesson_titles: m.lessons.map((l) => normalizeIngestDisplayTitle(l.title)),
  }));
  const title = resolveCourseDisplayTitle({
    planTitle: normalized.title,
    chunkTitles: modules.flatMap((m) => m.lesson_titles),
    uploadFileNames: options?.uploadFileNames,
  });
  const rawDescription = plan.description?.trim();
  const description =
    rawDescription && !isGenericIngestPlaceholder(rawDescription)
      ? rawDescription
      : title;
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

    // Group this module's chunks by their originating FILE (preserving first-seen
    // order) so a module that mixes sources (e.g. an image + a PDF) is labeled
    // per source and gets a FAIR share of the char budget — `truncateMaterial`
    // splits on the SOURCE marker below and allocates the budget round-robin
    // across sources instead of letting whichever file comes first win.
    const fileOrder: string[] = [];
    const blocksByFile = new Map<string, string[]>();
    for (const id of ordered) {
      const c = byId.get(id)!;
      const allowedPages = new Set(parsePageNumbersFromPosition(c.position));
      const chunkText = filterChunkTableBlocksToPages(c.text, allowedPages);
      const block = `[from ${c.sourceFileName} — ${c.position}]\n${enhanceTabularPlaintext(chunkText)}`;
      if (!blocksByFile.has(c.sourceFileName)) {
        blocksByFile.set(c.sourceFileName, []);
        fileOrder.push(c.sourceFileName);
      }
      blocksByFile.get(c.sourceFileName)!.push(block);
    }

    if (fileOrder.length <= 1) {
      const joined = enhanceTabularPlaintext(
        (blocksByFile.get(fileOrder[0]!) ?? []).join("\n\n")
      );
      return truncateMaterial(joined, cap);
    }

    const total = fileOrder.length;
    const sections = fileOrder.map((file, i) => {
      const marker = combinedSourceMarker(i + 1, total, file);
      return `${marker}\n${blocksByFile.get(file)!.join("\n\n")}`;
    });
    return truncateMaterial(sections.join("\n\n"), cap);
  });
}

/** Phase 1 of chunked PDF ingest — small JSON, usually finishes quickly. */
function normalizeOutlinePayload(
  outline: CourseOutlinePayload,
  options?: StructurePlanTitleOptions
): CourseOutlinePayload {
  const modules = outline.modules.map((m) => ({
    ...m,
    title: normalizeIngestDisplayTitle(m.title),
    lesson_titles: m.lesson_titles.map((t) => normalizeIngestDisplayTitle(t)),
  }));
  const lessonTitles = modules.flatMap((m) => m.lesson_titles);
  const title = resolveCourseDisplayTitle({
    planTitle: outline.title?.trim(),
    chunkTitles: lessonTitles,
    uploadFileNames: options?.uploadFileNames,
  });
  return { ...outline, title, modules };
}

export async function generateCourseOutlineFromMaterial(
  materialText: string,
  streamSink?: PdfIngestStreamSink,
  studyContext?: string,
  outputLanguage: CourseOutputLanguage = DEFAULT_COURSE_OUTPUT_LANGUAGE,
  titleOptions?: StructurePlanTitleOptions
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
  const instruction = outlineInstruction(
    trimmed,
    profile,
    studyContext,
    outputLanguage
  );

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
    return normalizeOutlinePayload(
      await repairOutlineJson(anthropic, rawText, profile),
      titleOptions
    );
  }

  try {
    return normalizeOutlinePayload(
      parseCourseOutlinePayload(parsed),
      titleOptions
    );
  } catch (e) {
    console.warn("[study-generation] outline validation failed; repairing", e);
    return normalizeOutlinePayload(
      await repairOutlineJson(anthropic, rawText, profile),
      titleOptions
    );
  }
}

function moduleMaxTokens(profile: CourseBuildProfile): number {
  if (profile === "express") {
    // Table-heavy PDFs (pharmacology MAC grids, etc.) need headroom beyond 5k.
    return clampInt(envInt("COURSE_EXPRESS_MODULE_MAX_TOKENS", 10_240), 4096, 20_480);
  }
  if (profile === "fast") {
    return clampInt(envInt("COURSE_FAST_MODULE_MAX_TOKENS", 12_288), 6144, 24_576);
  }
  if (profile === "full") return 30_720;
  return clampInt(envInt("COURSE_BALANCED_MODULE_MAX_TOKENS", 12_288), 8192, 30_720);
}

/** Escalating output budgets when the first pass truncates mid-JSON. */
function moduleMaxTokenBudgets(profile: CourseBuildProfile): number[] {
  const base = moduleMaxTokens(profile);
  const extra =
    profile === "express"
      ? [Math.min(20_480, Math.round(base * 1.6))]
      : profile === "fast"
        ? [Math.min(24_576, Math.round(base * 1.5))]
        : [Math.min(30_720, Math.round(base * 1.4))];
  return [...new Set([base, ...extra])].sort((a, b) => a - b);
}

function sanitizeGeneratedModuleLessons(mod: CourseModule): CourseModule {
  return {
    ...mod,
    lessons: mod.lessons.map((lesson) => ({
      ...lesson,
      content: sanitizeLessonContent(lesson.content ?? ""),
    })),
  };
}

async function finalizeGeneratedModules(
  anthropic: Anthropic,
  modules: CourseModule[],
  profile: CourseBuildProfile,
  sourceExcerpt: string,
  outputLanguage: CourseOutputLanguage
): Promise<CourseModule[]> {
  return Promise.all(
    modules.map(async (mod) => {
      // Guarantee every lesson has a real prose body before finalizing (BUG 1).
      const withLessons = await ensureModuleLessonFields(
        anthropic,
        mod,
        profile,
        sourceExcerpt,
        outputLanguage
      );
      const withQuiz = await ensureModuleQuizCount(
        withLessons,
        profile,
        outputLanguage
      );
      const sanitized = sanitizeGeneratedModuleLessons(withQuiz);
      return auditModuleQuantitativeConsistency(
        sanitized,
        sourceExcerpt,
        outputLanguage
      );
    })
  );
}

/** Prefer a real planned title; otherwise keep the LLM's generated title. */
function pickModuleTitle(
  plannedTitle: string | undefined,
  generatedTitle: string | undefined,
  moduleIndex: number
): string {
  const planned = normalizeIngestDisplayTitle(plannedTitle ?? "");
  if (planned && !isWeakModuleTitle(planned)) return planned;
  const generated = normalizeIngestDisplayTitle(generatedTitle ?? "");
  if (generated && !isWeakModuleTitle(generated)) return generated;
  return planned || generated || `Section ${moduleIndex + 1}`;
}

function isPlaceholderLessonTitle(title: string): boolean {
  const t = title.trim();
  if (!t) return true;
  if (/^(part|page|slide|section)\s+\d+$/i.test(t)) return true;
  return isBadIngestTitle(t);
}

/**
 * June-1 behavior: prefer the planned (outline / structure-plan) lesson title,
 * since that is the title the user reviewed and approved. Fall back to the
 * model's generated title only when the planned one is a positional placeholder
 * ("Part 1", "Slide 3"), and to a numbered label as a last resort.
 */
function pickLessonTitle(
  plannedTitle: string | undefined,
  generatedTitle: string | undefined,
  lessonIndex: number
): string {
  const planned = normalizeIngestDisplayTitle(plannedTitle ?? "");
  if (planned && !isPlaceholderLessonTitle(planned)) return planned;
  const generated = normalizeIngestDisplayTitle(generatedTitle ?? "");
  if (generated && !isPlaceholderLessonTitle(generated)) return generated;
  return planned || generated || `Part ${lessonIndex + 1}`;
}

function applyPlannedModuleTitles(
  mod: CourseModule,
  outline: CourseOutlinePayload,
  moduleIndex: number
): CourseModule {
  const stub = outline.modules[moduleIndex];
  if (!stub) return mod;
  const lessons = mod.lessons.map((lesson, li) => ({
    ...lesson,
    title: pickLessonTitle(stub.lesson_titles[li], lesson.title, li),
  }));
  let title = pickModuleTitle(stub.title, mod.title, moduleIndex);
  // When both the planned and generated module titles are weak placeholders
  // ("Section 3", "Part 1", a bare acronym), derive a descriptive title from
  // the (now descriptive) lesson titles — e.g. "A & B" — instead of leaving a
  // positional label in the header.
  if (isWeakModuleTitle(title)) {
    const derived = moduleTitleFromLessonTitles(lessons.map((l) => l.title));
    if (derived && !isWeakModuleTitle(derived)) title = derived;
  }
  return { ...mod, title, lessons };
}

/** Expand one module for chunked PDF ingest (separate server invocation). */
export type ModuleGenerationOptions = {
  assetManifestPrompt?: string;
  /** Skip post-parse quiz LLM backfill (PDF ingest uses append-quiz later). */
  skipQuizBackfill?: boolean;
};

export async function generateCourseModuleFromMaterial(
  materialText: string,
  outline: CourseOutlinePayload,
  moduleIndex: number,
  streamSink?: PdfIngestStreamSink,
  studyContext?: string,
  outputLanguage: CourseOutputLanguage = DEFAULT_COURSE_OUTPUT_LANGUAGE,
  moduleOptions?: ModuleGenerationOptions
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

  const enhanced = enhanceTabularPlaintext(materialText);
  const trimmed = truncateMaterial(enhanced, materialCharLimit(profile));
  logMaterialTableDiagnostics(
    `module-${moduleIndex + 1}/${outline.modules[moduleIndex]?.title ?? "?"}`,
    trimmed,
    moduleIndex
  );
  const instruction = moduleInstruction(
    trimmed,
    outline,
    moduleIndex,
    profile,
    studyContext,
    outputLanguage,
    moduleOptions?.assetManifestPrompt
  );

  const maxAttempts =
    profile === "express" || profile === "fast"
      ? 2
      : profile === "balanced"
        ? 3
        : 5;

  const tokenBudgets = moduleMaxTokenBudgets(profile);
  let lastRaw = "";

  const normalizeFromParsed = async (parsed: unknown): Promise<CourseModule> => {
    const obj = parsed as Record<string, unknown>;
    const mod = obj.module;
    const courseMod = parseCourseModuleLoose(mod);
    const expectedId = outline.modules[moduleIndex].id;
    const normalized =
      courseMod.id !== expectedId ? { ...courseMod, id: expectedId } : courseMod;
    const withLessons = await ensureModuleLessonFields(
      anthropic,
      normalized,
      profile,
      trimmed,
      outputLanguage
    );
    const withQuiz =
      moduleOptions?.skipQuizBackfill === true
        ? withLessons
        : await ensureModuleQuizCount(withLessons, profile, outputLanguage);
    const titled = applyPlannedModuleTitles(withQuiz, outline, moduleIndex);
    const sanitized = sanitizeGeneratedModuleLessons(titled);
    return auditModuleQuantitativeConsistency(
      sanitized,
      trimmed,
      outputLanguage
    );
  };

  for (let attempt = 0; attempt < tokenBudgets.length; attempt++) {
    const maxTok = tokenBudgets[attempt]!;
    const sink = attempt === 0 ? streamSink : undefined;
    if (attempt > 0) {
      console.warn(
        `[study-generation] module ${moduleIndex + 1} retry with max_tokens=${maxTok}`
      );
      await streamSink?.clear().catch(() => {});
    }

    const rawText = await invokeUserMessageForPdfText(
      anthropic,
      {
        model: resolveCourseModel(profile),
        max_tokens: maxTok,
        temperature: 0.2,
        messages: [{ role: "user", content: instruction }],
      },
      sink,
      maxAttempts
    );
    lastRaw = rawText;

    const stopTruncated = looksLikeTruncatedJson(rawText);
    if (stopTruncated && attempt < tokenBudgets.length - 1) {
      continue;
    }

    try {
      const parsed = JSON.parse(stripJsonFence(rawText));
      return await normalizeFromParsed(parsed);
    } catch (parseErr) {
      if (stopTruncated && attempt < tokenBudgets.length - 1) {
        continue;
      }
      console.warn(
        `[study-generation] module ${moduleIndex + 1} JSON parse failed; repairing`,
        parseErr
      );
      try {
        let repaired = await repairModuleJson(anthropic, rawText, profile);
        repaired = await ensureModuleLessonFields(
          anthropic,
          repaired,
          profile,
          trimmed,
          outputLanguage
        );
        if (moduleOptions?.skipQuizBackfill !== true) {
          repaired = await ensureModuleQuizCount(
            repaired,
            profile,
            outputLanguage
          );
        }
        return auditModuleQuantitativeConsistency(
          sanitizeGeneratedModuleLessons(
            applyPlannedModuleTitles(repaired, outline, moduleIndex)
          ),
          trimmed,
          outputLanguage
        );
      } catch (repairErr) {
        if (attempt < tokenBudgets.length - 1) continue;
        throw repairErr;
      }
    }
  }

  let repaired = await repairModuleJson(anthropic, lastRaw, profile);
  repaired = await ensureModuleLessonFields(
    anthropic,
    repaired,
    profile,
    trimmed,
    outputLanguage
  );
  if (moduleOptions?.skipQuizBackfill !== true) {
    repaired = await ensureModuleQuizCount(repaired, profile, outputLanguage);
  }
  return auditModuleQuantitativeConsistency(
    sanitizeGeneratedModuleLessons(
      applyPlannedModuleTitles(repaired, outline, moduleIndex)
    ),
    trimmed,
    outputLanguage
  );
}
