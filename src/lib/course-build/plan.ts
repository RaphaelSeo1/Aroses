import type { BuilderStrings } from "./language.ts";
import { pageWeight, type BuildPage } from "./outline.ts";

export type PlanModule = {
  /** Stable module id (1-based, plan order). Review cards key off it. */
  id: number;
  title: string;
  lessons: string[];
  /** Global page numbers this module is written from. */
  pages: number[];
  weight: number;
  /** Output the writer is asked to produce (pages × tokens per page). */
  targetTokens: number;
  /** Hard ceiling sent as max_tokens; headroom so a module is not cut off. */
  maxTokens: number;
  quizCount: number;
};

export type BuildPlan = {
  /** False when the source was too short for a planning call. */
  planned: boolean;
  title: string;
  description: string;
  modules: PlanModule[];
  skipPages: number[];
  infoPages: number[];
};

export type BudgetConfig = {
  outputTokensPerPage: number;
  /**
   * 1–2: how many more tokens the course's language needs than English for
   * the same content. Token targets grow by it; module boundaries don't, so
   * thin pages stay folded into a module with real content to teach from.
   */
  languageFactor?: number;
  strings?: Pick<BuilderStrings, "module" | "continued">;
};

function factorOf(cfg: BudgetConfig): number {
  const f = cfg.languageFactor ?? 1;
  return Number.isFinite(f) ? Math.min(2, Math.max(1, f)) : 1;
}

/** Sources shorter than this skip the planning call and become one module. */
export const PLAN_MIN_PAGES = 8;
/**
 * A module's quiz alone costs ~650 output tokens, so at ~200 tokens a page a
 * module needs about 8 pages of content to leave room for real lessons.
 */
export const PAGES_PER_MODULE = 8;
const MIN_MODULE_WEIGHT = 4;
const MAX_MODULE_WEIGHT = 16;
const MODULE_MIN_TARGET = 1_400;
const MODULE_MAX_TARGET = 5_000;
/** Writers overshoot small modules most (the quiz is a fixed size), so headroom has a floor. */
const MAX_TOKENS_HEADROOM = 1.5;
const MAX_TOKENS_MIN_HEADROOM = 900;

export function quizCountForWeight(weight: number): number {
  return Math.min(10, Math.max(6, 6 + Math.floor((weight - 6) / 4)));
}

export function moduleTargetTokens(weight: number, cfg: BudgetConfig): number {
  const f = factorOf(cfg);
  return Math.round(
    Math.min(MODULE_MAX_TARGET * f, Math.max(MODULE_MIN_TARGET * f, weight * cfg.outputTokensPerPage * f))
  );
}

export function moduleMaxTokens(weight: number, cfg: BudgetConfig): number {
  const target = moduleTargetTokens(weight, cfg);
  return Math.round(Math.max(target * MAX_TOKENS_HEADROOM, target + MAX_TOKENS_MIN_HEADROOM));
}

/** Upper bound on modules for a source, so each one has room to teach. */
export function maxModulesFor(totalWeight: number): number {
  return Math.max(1, Math.floor(totalWeight / PAGES_PER_MODULE));
}

function toInt(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function cleanTitle(v: unknown): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, 140) : "";
}

type Draft = { title: string; lessons: string[]; start: number };

function finishModules(drafts: Draft[], pages: BuildPage[], excluded: Set<number>, cfg: BudgetConfig): PlanModule[] {
  // The spend cap is per source page, so dense pages may share out the
  // budget differently but never add to it.
  const included = pages.filter((p) => !excluded.has(p.g));
  const rawTotal = included.reduce((sum, p) => sum + pageWeight(p.text), 0);
  const scale = rawTotal > included.length ? included.length / rawTotal : 1;
  const weights = new Map(pages.map((p) => [p.g, pageWeight(p.text) * scale]));
  const last = pages.length;

  type Span = { title: string; lessons: string[]; pages: number[]; weight: number };
  let spans: Span[] = drafts.map((d, i) => {
    const end = i + 1 < drafts.length ? drafts[i + 1].start - 1 : last;
    const own: number[] = [];
    for (let g = d.start; g <= end; g++) {
      if (!excluded.has(g) && (weights.get(g) ?? 0) > 0) own.push(g);
    }
    return {
      title: d.title,
      lessons: d.lessons,
      pages: own,
      weight: own.reduce((sum, g) => sum + (weights.get(g) ?? 0), 0),
    };
  });

  // Fold modules too thin to teach from into a neighbour.
  const merged: Span[] = [];
  for (const s of spans) {
    const prev = merged[merged.length - 1];
    if (prev && s.weight < MIN_MODULE_WEIGHT) {
      prev.pages.push(...s.pages);
      prev.weight += s.weight;
      prev.lessons = [...prev.lessons, ...s.lessons].slice(0, 5);
      continue;
    }
    merged.push({ ...s, pages: [...s.pages], lessons: [...s.lessons] });
  }
  if (merged.length > 1 && merged[0].weight < MIN_MODULE_WEIGHT) {
    const [first, second] = merged;
    second.pages = [...first.pages, ...second.pages];
    second.weight += first.weight;
    second.lessons = [...first.lessons, ...second.lessons].slice(0, 5);
    merged.shift();
  }
  spans = merged.filter((s) => s.pages.length > 0);

  // More modules than the budget can fill: merge the lightest neighbouring pair.
  const cap = maxModulesFor(spans.reduce((sum, s) => sum + s.weight, 0));
  while (spans.length > cap) {
    let best = 0;
    for (let i = 1; i < spans.length - 1; i++) {
      if (spans[i].weight + spans[i + 1].weight < spans[best].weight + spans[best + 1].weight) best = i;
    }
    const [a, b] = [spans[best], spans[best + 1]];
    spans.splice(best, 2, {
      title: a.weight >= b.weight ? a.title : b.title,
      lessons: [...a.lessons, ...b.lessons].slice(0, 5),
      pages: [...a.pages, ...b.pages],
      weight: a.weight + b.weight,
    });
  }

  // Split modules too big for one fast call, by page weight.
  const sized: Span[] = [];
  for (const s of spans) {
    if (s.weight <= MAX_MODULE_WEIGHT) {
      sized.push(s);
      continue;
    }
    const parts = Math.ceil(s.weight / 12);
    const target = s.weight / parts;
    const chunks: number[][] = [[]];
    let acc = 0;
    for (const g of s.pages) {
      const w = weights.get(g) ?? 0;
      if (acc >= target && chunks.length < parts) {
        chunks.push([]);
        acc = 0;
      }
      chunks[chunks.length - 1].push(g);
      acc += w;
    }
    const per = Math.max(1, Math.ceil(s.lessons.length / chunks.length));
    chunks.forEach((chunk, i) => {
      const lessons = s.lessons.slice(i * per, (i + 1) * per);
      sized.push({
        title: i === 0 ? s.title : lessons[0] || (cfg.strings?.continued ?? ((t: string) => `${t}, continued`))(s.title),
        lessons,
        pages: chunk,
        weight: chunk.reduce((sum, g) => sum + (weights.get(g) ?? 0), 0),
      });
    });
  }

  return sized.map((s, i) => ({
    id: i + 1,
    title: s.title || (cfg.strings?.module ?? ((n: number) => `Module ${n}`))(i + 1),
    lessons: s.lessons,
    pages: s.pages,
    weight: s.weight,
    targetTokens: moduleTargetTokens(s.weight, cfg),
    maxTokens: moduleMaxTokens(s.weight, cfg),
    quizCount: quizCountForWeight(s.weight),
  }));
}

/**
 * Turns whatever the planner returned into a usable plan: contiguous
 * in-order modules that together cover every content page.
 */
export function repairPlan(raw: unknown, pages: BuildPage[], cfg: BudgetConfig): BuildPlan {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const last = pages.length;
  const valid = (g: number | null): g is number => g != null && g >= 1 && g <= last;

  const pageList = (v: unknown) =>
    Array.isArray(v) ? [...new Set(v.map(toInt).filter(valid))] : [];
  const infoPages = pageList(o.info_pages);
  let skipPages = pageList(o.skip_pages).filter((g) => !infoPages.includes(g));

  const weightOf = (g: number) => pageWeight(pages[g - 1]?.text ?? "");
  const total = pages.reduce((sum, p) => sum + pageWeight(p.text), 0);
  const excludedWeight = [...skipPages, ...infoPages].reduce((sum, g) => sum + weightOf(g), 0);
  if (total > 0 && excludedWeight > total * 0.5) skipPages = [];
  const excluded = new Set([...skipPages, ...infoPages]);

  const rawModules = Array.isArray(o.modules) ? o.modules : [];
  const drafts: Draft[] = [];
  for (const m of rawModules) {
    if (!m || typeof m !== "object") continue;
    const r = m as Record<string, unknown>;
    const start = toInt(r.first_page);
    const title = cleanTitle(r.title);
    if (!title || !valid(start)) continue;
    const lessons = Array.isArray(r.lessons) ? r.lessons.map(cleanTitle).filter(Boolean).slice(0, 5) : [];
    drafts.push({ title, lessons, start });
  }
  drafts.sort((a, b) => a.start - b.start);
  const unique = drafts.filter((d, i) => i === 0 || d.start !== drafts[i - 1].start);
  if (unique.length === 0) unique.push({ title: cleanTitle(o.title) || "Module 1", lessons: [], start: 1 });
  unique[0].start = 1;

  return {
    planned: true,
    title: cleanTitle(o.title),
    description: typeof o.description === "string" ? o.description.trim().slice(0, 400) : "",
    modules: finishModules(unique, pages, excluded, cfg),
    skipPages: skipPages.sort((a, b) => a - b),
    infoPages: infoPages.sort((a, b) => a - b),
  };
}

/** Short sources: one module over every page; the writer supplies the titles. */
export function singleModulePlan(pages: BuildPage[], cfg: BudgetConfig): BuildPlan {
  return {
    planned: false,
    title: "",
    description: "",
    modules: finishModules([{ title: "", lessons: [], start: 1 }], pages, new Set(), cfg),
    skipPages: [],
    infoPages: [],
  };
}

export function totalContentWeight(pages: BuildPage[]): number {
  return pages.reduce((sum, p) => sum + pageWeight(p.text), 0);
}

/** Planner output budget: a title, description and a short line per module. */
export function planMaxTokens(pageCount: number): number {
  return Math.min(2_000, 400 + pageCount * 12);
}

/** What every module call is told about the rest of the course. */
export function planSummary(plan: BuildPlan): string {
  return plan.modules
    .map((m) => `${m.id}. ${m.title}${m.lessons.length ? `: ${m.lessons.join("; ")}` : ""}`)
    .join("\n");
}
