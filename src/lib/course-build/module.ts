import type {
  CourseLesson,
  CourseModule,
  CourseQuizFreeItem,
  CourseQuizItem,
  CourseQuizMcqItem,
  KeyTerm,
  SourceRef,
} from "@/types/course";
import {
  autoPlaceFigures,
  figureManifest,
  placeChosenFigures,
  placeFigures,
  type FigureAsset,
  type PlacedLesson,
} from "./figures.ts";
import { builderStrings, locatorKind, resolveBuildLanguage, visibleLength, type BuildLanguagePlan, type BuilderStrings } from "./language.ts";
import type { MeteredRequest } from "./metered-call.ts";
import type { BuildPage, BuildSourceInfo } from "./outline.ts";
import type { BuildPlan, PlanModule } from "./plan.ts";
import { planSummary } from "./plan.ts";
import { CONTENT_RULES, MODULE_TOOL, SINGLE_MODULE_TOOL } from "./prompts.ts";
import { fixLessonText, fixShortText } from "./text-rules.ts";

export type WriterContext = {
  plan: BuildPlan;
  module: PlanModule;
  pages: BuildPage[];
  sources: BuildSourceInfo[];
  studyGoal?: string | null;
  outputLanguage?: string | null;
  /** Resolved from `outputLanguage` and the pages when not given. */
  language?: BuildLanguagePlan;
  /** 1-based attempt; later attempts get more room in case the last one was cut off. */
  attempt: number;
  /** Validated figures on this module's pages; the writer may only place these. */
  figures?: FigureAsset[];
  /** Makes asset IDs unique across materials. */
  assetPrefix?: string;
};

/** Tokens a placed figure's marker line costs in the output. */
const FIGURE_MARKER_TOKENS = 22;

/** Measured on Haiku 4.5 output with the length limits in CONTENT_RULES. */
const QUIZ_TOKENS_PER_ITEM = 105;
const LESSON_EXTRAS_TOKENS = 110;
const JSON_OVERHEAD_TOKENS = 80;
const TOKENS_PER_WORD = 1.35;

export function quizSplit(count: number): { mcq: number; free: number } {
  const free = Math.max(1, Math.round(count / 3));
  return { mcq: count - free, free };
}

export function expectedLessonCount(weight: number): number {
  return Math.min(5, Math.max(2, Math.round(weight / 4)));
}

export type LengthUnit = {
  unit: "word" | "char";
  /** Output tokens per word (or character) of prose. */
  tokensPerUnit: number;
  /** Tokens for the same text relative to English (1–2); quiz and extras scale by it. */
  factor: number;
};

const ENGLISH_UNIT: LengthUnit = { unit: "word", tokensPerUnit: TOKENS_PER_WORD, factor: 1 };

export function lengthUnit(lang: BuildLanguagePlan | null | undefined): LengthUnit {
  const factor = lang?.factor ?? 1;
  const out = lang?.output;
  if (out) return { unit: out.unit, tokensPerUnit: out.tokensPerUnit, factor };
  return { unit: "word", tokensPerUnit: TOKENS_PER_WORD * factor, factor };
}

/** Words (or characters, for Chinese and Japanese) of lesson prose that fit in the module's output target. */
export function lessonWordBudget(targetTokens: number, quizCount: number, lessons: number, unit: LengthUnit = ENGLISH_UNIT): number {
  const prose =
    targetTokens -
    (quizCount * QUIZ_TOKENS_PER_ITEM + lessons * LESSON_EXTRAS_TOKENS) * unit.factor -
    JSON_OVERHEAD_TOKENS;
  const min = unit.unit === "char" ? 240 : 120;
  return Math.max(min, Math.round(prose / unit.tokensPerUnit / 10) * 10);
}

export function attemptMaxTokens(maxTokens: number, attempt: number): number {
  return Math.round(maxTokens * (1 + 0.3 * Math.max(0, attempt - 1)));
}

function writerMaxTokens(ctx: WriterContext): number {
  const figs = ctx.figures?.length ?? 0;
  return attemptMaxTokens(ctx.module.maxTokens + figs * FIGURE_MARKER_TOKENS, ctx.attempt);
}

function pagesBlock(ctx: WriterContext): string {
  const wanted = new Set(ctx.module.pages);
  const out: string[] = [];
  let lastSource = -1;
  for (const p of ctx.pages) {
    if (!wanted.has(p.g)) continue;
    if (ctx.sources.length > 1 && p.sourceIndex !== lastSource) {
      const s = ctx.sources.find((x) => x.index === p.sourceIndex);
      out.push(`== ${s?.label ?? `Source ${p.sourceIndex + 1}`} ==`);
    }
    lastSource = p.sourceIndex;
    const figs = (ctx.figures ?? []).filter((f) => f.g === p.g);
    out.push(`[p${p.g}]\n${p.text}${figs.length ? `\n${figureManifest(figs, p.text)}` : ""}`);
  }
  return out.join("\n\n");
}

function figuresBlock(ctx: WriterContext): string {
  const figs = ctx.figures ?? [];
  if (figs.length === 0) return "";
  const ids = figs.map((f) => f.id).join(", ");
  return `Figures: the pages list figures ${ids} (lines starting "[figure"). In each lesson's figures field, list the ones that illustrate that lesson, e.g. {"id": "${figs[0]!.id}", "caption": "..."}; the caption says what the figure shows in at most 15 words, only from the pages. Include every listed figure that fits a lesson, each ID at most once, never an ID not listed.`;
}

function languageOf(ctx: Pick<WriterContext, "module" | "pages" | "outputLanguage" | "language">): BuildLanguagePlan {
  if (ctx.language) return ctx.language;
  const wanted = new Set(ctx.module.pages);
  const text = ctx.pages
    .filter((p) => wanted.has(p.g))
    .map((p) => p.text)
    .join("\n");
  return resolveBuildLanguage(ctx.outputLanguage, text);
}

export function languageLine(lang: BuildLanguagePlan): string {
  const out = lang.output;
  if (!out) return "Write in the language of the pages.";
  const lines = [
    `Write every student-facing string in ${out.name}: titles, lessons, key terms, quiz questions, choices, answers, explanations and figure captions.`,
  ];
  if (lang.converting) {
    lines.push(
      `The pages may be in another language: translate faithfully into ${out.name}. Keep every number, unit, formula, name and table value exactly; keep a technical term in its original form after the translation when the field uses it. Translating is not a reason to add anything: no facts, numbers or ranges the pages don't state, even well-known ones; a thin page stays a short passage.`
    );
  }
  if (out.unit === "char") lines.push("Where a limit is given in words, count two characters as one word.");
  return lines.join("\n");
}

function goalLine(goal: string | null | undefined): string {
  const g = goal?.trim();
  return g ? `Student's goal (shapes emphasis only; never adds content): ${g.slice(0, 300)}\n` : "";
}

function taskLines(ctx: WriterContext): string {
  const { mcq, free } = quizSplit(ctx.module.quizCount);
  const lessons = expectedLessonCount(ctx.module.weight);
  const lang = languageOf(ctx);
  const unit = lengthUnit(lang);
  const words = lessonWordBudget(ctx.module.targetTokens, ctx.module.quizCount, lessons, unit);
  const perLesson = Math.max(unit.unit === "char" ? 120 : 60, Math.round(words / lessons / 10) * 10);
  const noun = unit.unit === "char" ? "characters" : "words";
  return [
    `Lessons: ${lessons} (use 2–5 only if the content clearly needs a different number). Each lesson's content is at most ${perLesson} ${noun}; stay under ${words} ${noun} across all lessons. Spend them on explanation, not on key terms or examples.`,
    `Quiz: exactly ${ctx.module.quizCount} questions, ${mcq} multiple_choice then ${free} free_response.`,
    languageLine(lang),
  ].join("\n");
}

export function moduleRequest(ctx: WriterContext): MeteredRequest {
  const m = ctx.module;
  const suggested = m.lessons.length ? ` Suggested lessons: ${m.lessons.join("; ")}.` : "";
  const text = [
    `Course: ${ctx.plan.title || "Untitled"}`,
    goalLine(ctx.studyGoal).trimEnd(),
    `Plan (each module teaches only its own topics):\n${planSummary(ctx.plan)}`,
    "",
    `Write module ${m.id}: "${m.title}".${suggested}`,
    taskLines(ctx),
    "",
    `Pages:\n${pagesBlock(ctx)}`,
    "",
    figuresBlock(ctx),
  ]
    .filter((l) => l !== "")
    .join("\n");
  return {
    max_tokens: writerMaxTokens(ctx),
    system: CONTENT_RULES,
    tools: [MODULE_TOOL],
    tool_choice: { type: "tool", name: MODULE_TOOL.name },
    messages: [{ role: "user", content: text }],
  };
}

export function singleModuleRequest(ctx: WriterContext): MeteredRequest {
  const text = [
    goalLine(ctx.studyGoal).trimEnd(),
    "This material is short, so it becomes one module. Also give: title (a short title for the material, from its content, not the file name), description (one sentence on what it teaches), module_title (names the concept).",
    taskLines(ctx),
    "",
    `Pages:\n${pagesBlock(ctx)}`,
    "",
    figuresBlock(ctx),
  ]
    .filter((l) => l !== "")
    .join("\n");
  return {
    max_tokens: writerMaxTokens(ctx),
    system: CONTENT_RULES,
    tools: [SINGLE_MODULE_TOOL],
    tool_choice: { type: "tool", name: SINGLE_MODULE_TOOL.name },
    messages: [{ role: "user", content: text }],
  };
}

/** The writer's output could not be turned into a usable module; worth one more try. */
export class ModuleOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModuleOutputError";
  }
}

function s(v: unknown): string {
  return typeof v === "string" ? v : "";
}


/** "slides 12–17" per source file, from the lesson's global page range. */
export function lessonSources(
  first: number,
  last: number,
  modulePages: number[],
  pages: BuildPage[],
  sources: BuildSourceInfo[],
  strings: Pick<BuilderStrings, "locator"> = builderStrings(null)
): SourceRef[] {
  const lo = Math.min(...modulePages);
  const hi = Math.max(...modulePages);
  let a = Number.isFinite(first) ? Math.max(lo, Math.min(hi, first)) : lo;
  let b = Number.isFinite(last) ? Math.max(lo, Math.min(hi, last)) : hi;
  if (a > b) [a, b] = [b, a];
  const bySource = new Map<number, number[]>();
  for (const p of pages) {
    if (p.g < a || p.g > b) continue;
    const list = bySource.get(p.sourceIndex) ?? [];
    list.push(p.n);
    bySource.set(p.sourceIndex, list);
  }
  const refs: SourceRef[] = [];
  for (const [idx, ns] of bySource) {
    const src = sources.find((x) => x.index === idx);
    if (!src) continue;
    refs.push({ fileName: src.label, locator: strings.locator(locatorKind(src.kind), Math.min(...ns), Math.max(...ns)) });
  }
  return refs;
}

type Difficulty = "easy" | "medium" | "hard";

function difficulty(v: unknown): Difficulty {
  const d = s(v).toLowerCase();
  return d === "easy" || d === "hard" ? d : "medium";
}

function toQuizItem(raw: unknown, fallbackExplanation: string): CourseQuizItem | null {
  if (!raw || typeof raw !== "object") return null;
  const q = raw as Record<string, unknown>;
  const question = fixShortText(s(q.question));
  const explanation = fixShortText(s(q.explanation)) || fallbackExplanation;
  if (visibleLength(question) < 4) return null;
  const kind = s(q.kind).toLowerCase();
  const choices = Array.isArray(q.choices) ? q.choices.map((c) => fixShortText(s(c))) : [];
  if (kind === "multiple_choice" || (kind !== "free_response" && choices.length === 4)) {
    const idx = typeof q.correct_choice === "number" ? Math.round(q.correct_choice) : -1;
    if (choices.length !== 4 || choices.some((c) => !c) || idx < 0 || idx > 3) return null;
    if (new Set(choices.map((c) => c.toLowerCase())).size < 4) return null;
    const item: CourseQuizMcqItem = {
      type: "mcq",
      difficulty: difficulty(q.difficulty),
      question,
      choices: choices as [string, string, string, string],
      correct: String.fromCharCode(65 + idx),
      correctIndex: idx,
      explanation,
    };
    return item;
  }
  const referenceAnswer = fixShortText(s(q.reference_answer));
  if (visibleLength(referenceAnswer) < 6) return null;
  const item: CourseQuizFreeItem = {
    type: "free_response",
    difficulty: difficulty(q.difficulty),
    question,
    referenceAnswer,
    explanation,
  };
  return item;
}

function toKeyTerms(raw: unknown): KeyTerm[] {
  if (!Array.isArray(raw)) return [];
  const out: KeyTerm[] = [];
  const seen = new Set<string>();
  for (const k of raw) {
    if (!k || typeof k !== "object") continue;
    const term = fixShortText(s((k as Record<string, unknown>).term));
    const definition = fixShortText(s((k as Record<string, unknown>).definition));
    if (visibleLength(term) < 2 || visibleLength(definition) < 4 || seen.has(term.toLowerCase())) continue;
    seen.add(term.toLowerCase());
    out.push({ term, definition });
  }
  return out.slice(0, 12);
}

export type ConvertedModule = {
  module: CourseModule;
  /** Things worth logging but not worth a retry. */
  notes: string[];
};

/** Maps the writer's tool input onto the app's `CourseModule`. */
export function toCourseModule(
  input: unknown,
  ctx: Pick<WriterContext, "module" | "pages" | "sources" | "figures" | "assetPrefix" | "outputLanguage" | "language">,
  title: string
): ConvertedModule {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const lang = languageOf(ctx);
  const captions = { converting: lang.converting, fromPage: lang.strings.figureFromPage };
  const notes: string[] = [];
  const figures = new Map((ctx.figures ?? []).map((f) => [f.id, f]));
  const usedFigures = new Set<string>();
  const droppedFigures: string[] = [];
  const pageText = (g: number) => ctx.pages.find((p) => p.g === g)?.text ?? "";

  const ordered: Array<{ lesson: CourseLesson; start: number; placed: PlacedLesson }> = [];
  for (const raw of Array.isArray(o.lessons) ? o.lessons : []) {
    if (!raw || typeof raw !== "object") continue;
    const l = raw as Record<string, unknown>;
    const lessonTitle = fixShortText(s(l.title));
    const placed = placeFigures(fixLessonText(s(l.content)), figures, usedFigures, pageText, ctx.assetPrefix ?? "", captions);
    const content = placed.content;
    droppedFigures.push(...placed.dropped);
    if (!lessonTitle || visibleLength(content) < 40) continue;
    const examples = (Array.isArray(l.examples) ? l.examples : [])
      .map((e) => fixShortText(s(e)))
      .filter((e) => visibleLength(e) >= 4)
      .slice(0, 2);
    const sources = lessonSources(
      Number(l.first_page),
      Number(l.last_page),
      ctx.module.pages,
      ctx.pages,
      ctx.sources,
      lang.strings
    );
    const start = Number(l.first_page);
    const end = Number(l.last_page);
    const lessonFigures: PlacedLesson = {
      content,
      firstPage: Number.isFinite(start) ? start : -1,
      lastPage: Number.isFinite(end) ? Math.max(end, start) : Number.isFinite(start) ? start : -1,
      assets: placed.assets,
    };
    const chosen = (Array.isArray(l.figures) ? l.figures : [])
      .map((c) => (c && typeof c === "object" ? (c as Record<string, unknown>) : {}))
      .map((c) => ({ id: s(c.id), caption: fixShortText(s(c.caption)) }))
      .filter((c) => c.id);
    droppedFigures.push(
      ...placeChosenFigures(lessonFigures, chosen, figures, usedFigures, pageText, ctx.assetPrefix ?? "", captions)
    );
    ordered.push({
      start: Number.isFinite(start) ? start : Number.MAX_SAFE_INTEGER,
      placed: lessonFigures,
      lesson: {
        title: lessonTitle,
        content,
        key_terms: toKeyTerms(l.key_terms),
        examples,
        ...(sources.length ? { sources } : {}),
      },
    });
  }
  if (droppedFigures.length) notes.push(`figures dropped ${droppedFigures.join(",")}`);
  // Lessons follow the source's order even when the writer reorders them.
  const sorted = ordered.map((x, i) => ({ ...x, i })).sort((a, b) => a.start - b.start || a.i - b.i);
  const auto = autoPlaceFigures(
    sorted.map((x) => x.placed),
    ctx.figures ?? [],
    usedFigures,
    pageText,
    ctx.assetPrefix ?? "",
    captions
  );
  if (auto.length) notes.push(`figures auto-placed ${auto.join(",")}`);
  const lessons = sorted.map((x) =>
    x.placed.assets.length ? { ...x.lesson, visual_assets: x.placed.assets } : x.lesson
  );
  if (lessons.length === 0) throw new ModuleOutputError("The writer returned no usable lessons.");

  const quiz = (Array.isArray(o.quiz) ? o.quiz : [])
    .map((q) => toQuizItem(q, lang.strings.quizFallback))
    .filter((q): q is CourseQuizItem => q != null);
  const target = ctx.module.quizCount;
  if (quiz.length < Math.min(3, target)) {
    throw new ModuleOutputError(`The writer returned ${quiz.length} usable quiz questions.`);
  }
  if (quiz.length < target) notes.push(`quiz ${quiz.length}/${target}`);
  if (lessons.length > 5) notes.push(`lessons ${lessons.length}`);

  return {
    module: { id: ctx.module.id, title: title || lessons[0].title, lessons, quiz: quiz.slice(0, 10) },
    notes,
  };
}
