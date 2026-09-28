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

/** Words of lesson prose that fit in the module's output target. */
export function lessonWordBudget(targetTokens: number, quizCount: number, lessons: number): number {
  const prose =
    targetTokens - quizCount * QUIZ_TOKENS_PER_ITEM - lessons * LESSON_EXTRAS_TOKENS - JSON_OVERHEAD_TOKENS;
  return Math.max(120, Math.round(prose / TOKENS_PER_WORD / 10) * 10);
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
    out.push(`[p${p.g}]\n${p.text}${figs.length ? `\n${figureManifest(figs)}` : ""}`);
  }
  return out.join("\n\n");
}

function figuresBlock(ctx: WriterContext): string {
  const figs = ctx.figures ?? [];
  if (figs.length === 0) return "";
  const ids = figs.map((f) => f.id).join(", ");
  return `Figures: the pages list figures ${ids} (lines starting "[figure"). In each lesson's figures field, list the ones that illustrate that lesson, e.g. {"id": "${figs[0]!.id}", "caption": "..."}; the caption says what the figure shows in at most 15 words, only from the pages. Include every listed figure that fits a lesson, each ID at most once, never an ID not listed.`;
}

function languageLine(lang: string | null | undefined): string {
  return lang ? `Write in ${lang}.` : "Write in the language of the pages.";
}

function goalLine(goal: string | null | undefined): string {
  const g = goal?.trim();
  return g ? `Student's goal (shapes emphasis only; never adds content): ${g.slice(0, 300)}\n` : "";
}

function taskLines(ctx: WriterContext): string {
  const { mcq, free } = quizSplit(ctx.module.quizCount);
  const lessons = expectedLessonCount(ctx.module.weight);
  const words = lessonWordBudget(ctx.module.targetTokens, ctx.module.quizCount, lessons);
  const perLesson = Math.max(60, Math.round(words / lessons / 10) * 10);
  return [
    `Lessons: ${lessons} (use 2–5 only if the content clearly needs a different number). Each lesson's content is at most ${perLesson} words; stay under ${words} words across all lessons. Spend the words on explanation, not on key terms or examples.`,
    `Quiz: exactly ${ctx.module.quizCount} questions, ${mcq} multiple_choice then ${free} free_response.`,
    languageLine(ctx.outputLanguage),
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

function locatorFor(kind: string, a: number, b: number): string {
  const noun =
    kind === "pptx" ? ["slide", "slides"] : kind === "pdf" ? ["page", "pages"] : ["part", "parts"];
  return a === b ? `${noun[0]} ${a}` : `${noun[1]} ${a}–${b}`;
}

/** "slides 12–17" per source file, from the lesson's global page range. */
export function lessonSources(
  first: number,
  last: number,
  modulePages: number[],
  pages: BuildPage[],
  sources: BuildSourceInfo[]
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
    refs.push({ fileName: src.label, locator: locatorFor(src.kind, Math.min(...ns), Math.max(...ns)) });
  }
  return refs;
}

type Difficulty = "easy" | "medium" | "hard";

function difficulty(v: unknown): Difficulty {
  const d = s(v).toLowerCase();
  return d === "easy" || d === "hard" ? d : "medium";
}

function toQuizItem(raw: unknown): CourseQuizItem | null {
  if (!raw || typeof raw !== "object") return null;
  const q = raw as Record<string, unknown>;
  const question = fixShortText(s(q.question));
  const explanation = fixShortText(s(q.explanation)) || "Review the module lessons for this idea.";
  if (question.length < 4) return null;
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
  if (referenceAnswer.length < 6) return null;
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
    if (term.length < 2 || definition.length < 4 || seen.has(term.toLowerCase())) continue;
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
  ctx: Pick<WriterContext, "module" | "pages" | "sources" | "figures" | "assetPrefix">,
  title: string
): ConvertedModule {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
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
    const placed = placeFigures(fixLessonText(s(l.content)), figures, usedFigures, ctx.assetPrefix ?? "");
    const content = placed.content;
    droppedFigures.push(...placed.dropped);
    if (!lessonTitle || content.length < 40) continue;
    const examples = (Array.isArray(l.examples) ? l.examples : [])
      .map((e) => fixShortText(s(e)))
      .filter((e) => e.length >= 4)
      .slice(0, 2);
    const sources = lessonSources(
      Number(l.first_page),
      Number(l.last_page),
      ctx.module.pages,
      ctx.pages,
      ctx.sources
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
    droppedFigures.push(...placeChosenFigures(lessonFigures, chosen, figures, usedFigures, pageText, ctx.assetPrefix ?? ""));
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
    ctx.assetPrefix ?? ""
  );
  if (auto.length) notes.push(`figures auto-placed ${auto.join(",")}`);
  const lessons = sorted.map((x) =>
    x.placed.assets.length ? { ...x.lesson, visual_assets: x.placed.assets } : x.lesson
  );
  if (lessons.length === 0) throw new ModuleOutputError("The writer returned no usable lessons.");

  const quiz = (Array.isArray(o.quiz) ? o.quiz : []).map(toQuizItem).filter((q): q is CourseQuizItem => q != null);
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
