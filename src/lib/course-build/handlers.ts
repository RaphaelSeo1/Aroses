import type Anthropic from "@anthropic-ai/sdk";
import type { CourseModule, CoursePayload } from "@/types/course";
import { cleanPages, paginateText, type SourcePage } from "./clean.ts";
import type { CourseBuildConfig } from "./config.ts";
import { AiCallError, StepFatalError } from "./errors.ts";
import { stripFigureMarkers } from "./figure-markers.ts";
import { reviewFigures, type ReviewVerdict, type SheetMaker } from "./figure-review.ts";
import {
  MAX_FIGURES_PER_BUILD,
  acceptFigures,
  dropRepeatedImages,
  figuresForPages,
  globalPage,
  rankCandidates,
  splitForReview,
  type Box,
  type FigureAsset,
  type FigureCandidate,
  type FiguresStepOutput,
} from "./figures.ts";
import { meteredClaudeCall, type MessagesClient } from "./metered-call.ts";
import {
  ModuleOutputError,
  moduleRequest,
  singleModuleRequest,
  toCourseModule,
  type WriterContext,
} from "./module.ts";
import { compactOutline, numberPages, type BuildPage, type BuildSourceInfo } from "./outline.ts";
import {
  PLAN_MIN_PAGES,
  maxModulesFor,
  planMaxTokens,
  repairPlan,
  singleModulePlan,
  totalContentWeight,
  type BuildPlan,
} from "./plan.ts";
import { PLAN_RULES, PLAN_TOOL } from "./prompts.ts";
import { buildSpendCapUsd } from "./pricing.ts";
import type { StepHandler, StepHandlers } from "./runner.ts";
import type { CourseBuildStore, NewStep } from "./store.ts";

export type SourceKind =
  | "pdf"
  | "pptx"
  | "docx"
  | "image"
  | "audio"
  | "video"
  | "transcript"
  | "text"
  | "url"
  | "note"
  | "live_session"
  | "tutor_session";

export const TEXT_KINDS: ReadonlySet<string> = new Set(["transcript", "text", "note", "live_session", "tutor_session"]);
/** Running prose (transcripts, articles): no slide boilerplate to strip. */
const PROSE_KINDS: ReadonlySet<string> = new Set(["audio", "video", "url", ...TEXT_KINDS]);

export type BuildRecord = {
  id: string;
  userId: string;
  courseId: string;
  examGroupId: string | null;
  materialId: string | null;
  outputLanguage: string | null;
  studyGoal: string | null;
  usageReservationId?: string | null;
};

export type SourceRecord = {
  id: string;
  position: number;
  kind: string;
  label: string;
  storagePath: string | null;
  sourceUrl: string | null;
  pages: SourcePage[] | null;
};

export type CourseInfoEntry = {
  fileName: string;
  locator: string;
  text: string;
};

export type PublishInput = {
  build: BuildRecord;
  payload: CoursePayload;
  final: boolean;
  courseInfo?: CourseInfoEntry[];
};

/** Everything the handlers read or write besides the step store. */
export interface BuildData {
  getBuild(buildId: string): Promise<BuildRecord>;
  listSources(buildId: string): Promise<SourceRecord[]>;
  saveSourcePages(sourceId: string, pages: SourcePage[]): Promise<void>;
  /** Sets the page count and the build's spend cap. Runs before the first AI call. */
  setBuildSize(buildId: string, sourcePages: number, spendCapUsd: number): Promise<void>;
  savePlan(buildId: string, plan: BuildPlan, courseInfo: CourseInfoEntry[]): Promise<void>;
  /** The saved output of the build's finished plan step. */
  getPlan(buildId: string): Promise<BuildPlan | null>;
  /** Saved outputs of finished module steps. */
  listModuleOutputs(buildId: string): Promise<ModuleStepOutput[]>;
  /** Creates or updates the build's material row. Returns its id. */
  publish(input: PublishInput): Promise<string>;
  /** Saves the partial module text for the build screen. Only the step's owner may write. */
  savePreview?(stepId: string, owner: string, preview: ModulePreview): Promise<void>;
  /**
   * Billing hook, called once the real page count is known and before any AI
   * call. Throws StepFatalError when the student's plan can't cover the pages.
   */
  reservePages?(build: BuildRecord, pages: number): Promise<void>;
  /** Stores a figure image and returns its public URL. */
  saveFigure?(build: BuildRecord, figureId: string, image: Buffer, mime: string): Promise<string>;
  /** Figures from the build's finished figures steps. */
  listFigures?(buildId: string): Promise<FigureAsset[]>;
}

/** Finds figure crops in a stored PDF without any AI. */
export type FindFiguresFn = (
  source: SourceRecord,
  signal?: AbortSignal
) => Promise<{ candidates: FigureCandidate[]; repeated: Box[]; pagesRendered?: number; truncated?: boolean }>;

export type ModulePreview = {
  title?: string;
  moduleTitle?: string;
  lessons: Array<{ title: string; content: string }>;
  quiz: number;
};

const PREVIEW_INTERVAL_MS = 1000;
const RESERVE_POLL_MS = 1000;
const PREVIEW_LESSON_CHARS = 12_000;

export function previewFromSnapshot(snapshot: unknown): ModulePreview | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const s = snapshot as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const lessons = (Array.isArray(s.lessons) ? s.lessons : [])
    .filter((l): l is Record<string, unknown> => !!l && typeof l === "object")
    .map((l) => ({
      title: str(l.title).slice(0, 200),
      content: stripFigureMarkers(str(l.content)).slice(0, PREVIEW_LESSON_CHARS),
    }))
    .filter((l) => l.title || l.content);
  const preview: ModulePreview = { lessons, quiz: Array.isArray(s.quiz) ? s.quiz.length : 0 };
  if (str(s.title)) preview.title = str(s.title).slice(0, 140);
  if (str(s.module_title)) preview.moduleTitle = str(s.module_title).slice(0, 140);
  return preview.lessons.length > 0 || preview.title ? preview : null;
}

/** Saves at most one preview per interval, never two at once, always the newest. */
function previewWriter(save: (p: ModulePreview) => Promise<void>, log: HandlerDeps["log"]) {
  let latest: ModulePreview | null = null;
  let lastAt = 0;
  let writing = false;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = async () => {
    timer = null;
    if (stopped || writing || !latest) return;
    const next = latest;
    latest = null;
    writing = true;
    lastAt = Date.now();
    try {
      await save(next);
    } catch (err) {
      log?.("course-build preview save failed", { error: err instanceof Error ? err.message : String(err) });
    } finally {
      writing = false;
      if (latest && !stopped) schedule();
    }
  };
  const schedule = () => {
    if (timer || stopped) return;
    timer = setTimeout(() => void flush(), Math.max(0, lastAt + PREVIEW_INTERVAL_MS - Date.now()));
    (timer as { unref?: () => void }).unref?.();
  };
  return {
    push(snapshot: unknown) {
      const p = previewFromSnapshot(snapshot);
      if (!p || stopped) return;
      latest = p;
      schedule();
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}

/** Turns a stored file into raw pages. Text sources skip this. */
export type ExtractFn = (source: SourceRecord) => Promise<SourcePage[]>;

export type ModuleStepOutput = {
  module: CourseModule;
  /** Set only for one-module builds, where the writer also names the material. */
  title?: string;
  description?: string;
  notes: string[];
  costUsd: number;
};

export type HandlerDeps = {
  store: CourseBuildStore;
  client: MessagesClient;
  config: CourseBuildConfig;
  data: BuildData;
  extract: ExtractFn;
  /** Without it (or without data.saveFigure) the figures step finds nothing. */
  findFigures?: FindFiguresFn;
  /** Tiles review thumbnails into contact sheets; without it each crop is its own image. */
  makeContactSheet?: SheetMaker;
  /** Final gate: the payload must parse exactly as the viewers parse it. */
  validatePayload: (payload: unknown) => CoursePayload;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
};

type ExtractInput = { sourceId: string; text?: string };
type ModuleInput = { moduleId: number };
type FiguresInput = { sourceId: string };

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function toolInput(message: Anthropic.Message, name: string): unknown {
  if (message.stop_reason === "max_tokens") {
    throw new AiCallError("The AI response was cut off at its length limit.", { retryable: true, status: null });
  }
  const block = message.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === name
  );
  if (!block) {
    throw new AiCallError(`The AI response had no ${name} result (stop: ${message.stop_reason}).`, {
      retryable: true,
      status: null,
    });
  }
  return block.input;
}

function sourceInfos(sources: SourceRecord[]): BuildSourceInfo[] {
  return sources
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((s) => ({ index: s.position, label: s.label, kind: s.kind, pages: s.pages ?? [] }));
}

function courseInfoFrom(plan: BuildPlan, pages: BuildPage[], sources: BuildSourceInfo[]): CourseInfoEntry[] {
  const out: CourseInfoEntry[] = [];
  for (const g of plan.infoPages) {
    const p = pages[g - 1];
    if (!p || !p.text.trim()) continue;
    const src = sources.find((s) => s.index === p.sourceIndex);
    const noun = src?.kind === "pptx" ? "slide" : src?.kind === "pdf" ? "page" : "part";
    out.push({ fileName: src?.label ?? "", locator: `${noun} ${p.n}`, text: p.text });
  }
  return out;
}

export function createStepHandlers(deps: HandlerDeps): StepHandlers {
  const { store, client, config, data, log = () => {} } = deps;
  const metered = { store, client, config, log };
  const publishQueue = new Map<string, Promise<unknown>>();

  /** One publish at a time per build, so parallel modules never overwrite each other. */
  const serialized = <T>(buildId: string, fn: () => Promise<T>): Promise<T> => {
    const prev = publishQueue.get(buildId) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    publishQueue.set(buildId, next.catch(() => {}));
    return next;
  };

  const loadPages = async (buildId: string) => {
    const sources = sourceInfos(await data.listSources(buildId));
    return { sources, pages: numberPages(sources) };
  };

  const extract: StepHandler = async (step) => {
    const input = (step.input ?? {}) as ExtractInput;
    const all = await data.listSources(step.buildId);
    const source = all.find((s) => s.id === input.sourceId);
    if (!source) throw new StepFatalError("source_missing", "One of the files for this build is missing.");
    if (source.pages && source.pages.length > 0) {
      return { output: { pages: source.pages.length, reused: true } };
    }

    const inline = typeof input.text === "string";
    const raw: SourcePage[] = inline ? paginateText(input.text ?? "") : await deps.extract(source);
    const pages = inline || PROSE_KINDS.has(source.kind) ? raw : cleanPages(raw);
    await data.saveSourcePages(source.id, pages);
    return { output: { pages: pages.length } };
  };

  const plan: StepHandler = async (step, ctx) => {
    const build = await data.getBuild(step.buildId);
    const { sources, pages } = await loadPages(step.buildId);
    await data.setBuildSize(step.buildId, pages.length, buildSpendCapUsd(pages.length, config));

    if (pages.length === 0 || totalContentWeight(pages) === 0) {
      throw new StepFatalError(
        "no_text",
        "We couldn't find any readable text in these files. If a PDF is scanned, export it with selectable text and try again."
      );
    }
    await data.reservePages?.(build, pages.length);

    let result: BuildPlan;
    if (pages.length < PLAN_MIN_PAGES) {
      result = singleModulePlan(pages, config);
    } else {
      const goal = build.studyGoal?.trim();
      const { message } = await meteredClaudeCall(
        metered,
        { buildId: step.buildId, stepId: step.id, userId: build.userId, purpose: "plan" },
        {
          max_tokens: planMaxTokens(pages.length),
          system: PLAN_RULES,
          tools: [PLAN_TOOL],
          tool_choice: { type: "tool", name: PLAN_TOOL.name },
          messages: [
            {
              role: "user",
              content: `${goal ? `Student's goal (emphasis only): ${goal.slice(0, 300)}\n` : ""}${
                build.outputLanguage ? `Write titles in ${build.outputLanguage}.\n` : ""
              }Module limit: ${maxModulesFor(totalContentWeight(pages))}.\nOutline (${pages.length} pages):\n${compactOutline(pages, sources)}`,
            },
          ],
        },
        { signal: ctx.signal }
      );
      result = repairPlan(toolInput(message, PLAN_TOOL.name), pages, config);
    }

    if (result.modules.length === 0) {
      throw new StepFatalError("no_content", "These files don't contain enough teaching content to build a course from.");
    }
    await data.savePlan(step.buildId, result, courseInfoFrom(result, pages, sources));

    const newSteps: NewStep[] = result.modules.map((m) => ({
      kind: "module",
      ordinal: m.id - 1,
      wave: 2,
      input: { moduleId: m.id } satisfies ModuleInput,
      maxAttempts: config.maxStepAttempts,
    }));
    newSteps.push({ kind: "finalize", ordinal: 0, wave: 3, input: {}, maxAttempts: config.maxStepAttempts });
    return { output: result, newSteps };
  };

  /**
   * The plan step reserves the student's pages before it finishes, so a saved
   * plan means the build is paid for. False when it doesn't arrive in time or
   * the build is already failing or canceled.
   */
  const planFinished = async (buildId: string, signal: AbortSignal): Promise<boolean> => {
    const until = Date.now() + config.figureReserveWaitMs;
    for (;;) {
      if (await data.getPlan(buildId)) return true;
      if (Date.now() >= until) return false;
      const p = await store.progress(buildId);
      if (!p || p.failed > 0 || p.cancelRequested) return false;
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          signal.removeEventListener("abort", done);
          resolve();
        };
        const timer = setTimeout(done, RESERVE_POLL_MS);
        signal.addEventListener("abort", done, { once: true });
      });
      if (signal.aborted) throw new Error("Build canceled while waiting for the plan.");
    }
  };

  /**
   * Optional by design: any failure here leaves the course without figures
   * rather than failing the build. Only a cancel propagates.
   */
  const figures: StepHandler = async (step, ctx) => {
    const { sourceId } = (step.input ?? {}) as FiguresInput;
    const out: FiguresStepOutput = { figures: [], candidates: 0, checked: 0, costUsd: 0 };
    const findFigures = deps.findFigures;
    const saveFigure = data.saveFigure?.bind(data);
    if (!findFigures || !saveFigure) return { output: out };
    try {
      const [build, all] = await Promise.all([data.getBuild(step.buildId), data.listSources(step.buildId)]);
      const source = all.find((s) => s.id === sourceId);
      if (!source || source.kind !== "pdf") return { output: out };
      const pages = numberPages(sourceInfos(all));
      const text = (n: number) => source.pages?.find((p) => p.n === n)?.text ?? "";

      const t0 = Date.now();
      const found = await findFigures(source, ctx.signal);
      out.candidates = found.candidates.length;
      log("course-build figures scanned", {
        buildId: step.buildId,
        candidates: found.candidates.length,
        pagesRendered: found.pagesRendered,
        truncated: found.truncated,
        ms: Date.now() - t0,
      });
      const ranked = dropRepeatedImages(rankCandidates(found.candidates, text, found.repeated));
      if (ranked.length === 0) return { output: out };
      if (!(await planFinished(step.buildId, ctx.signal))) {
        log("course-build figures skipped", { buildId: step.buildId, error: "pages not reserved" });
        return { output: out };
      }
      const split = splitForReview(ranked, config.visionMaxCrops);
      let verdicts: Array<ReviewVerdict | null> | null = null;
      if (split.review.length > 0) {
        try {
          const r = await reviewFigures(
            metered,
            { buildId: step.buildId, stepId: step.id, userId: build.userId, purpose: "vision:figures" },
            split.review,
            { signal: ctx.signal, makeSheet: deps.makeContactSheet }
          );
          verdicts = r.verdicts;
          out.costUsd = r.costUsd;
          out.checked = split.review.length;
        } catch (err) {
          if (ctx.signal.aborted) throw err;
          log("course-build figure review skipped", { buildId: step.buildId, error: errText(err) });
        }
      }

      for (const [i, a] of acceptFigures(split, verdicts).slice(0, MAX_FIGURES_PER_BUILD).entries()) {
        const c = a.r.candidate;
        const g = globalPage(pages, source.position, c.page);
        if (g == null) continue;
        const id = `F${source.position * 100 + i + 1}`;
        try {
          const url = await saveFigure(build, id, c.image, c.mime);
          out.figures.push({
            id,
            g,
            sourceIndex: source.position,
            page: c.page,
            kind: a.kind,
            url,
            label: a.r.label,
            description: a.description,
            width: c.width,
            height: c.height,
          });
        } catch (err) {
          log("course-build figure upload failed", { buildId: step.buildId, id, error: errText(err) });
        }
      }
    } catch (err) {
      if (ctx.signal.aborted) throw err;
      log("course-build figures skipped", { buildId: step.buildId, error: errText(err) });
    }
    return { output: out };
  };

  const writeModule: StepHandler = async (step, ctx) => {
    const { moduleId } = (step.input ?? {}) as ModuleInput;
    const [build, planned, loaded, allFigures] = await Promise.all([
      data.getBuild(step.buildId),
      data.getPlan(step.buildId),
      loadPages(step.buildId),
      data.listFigures ? data.listFigures(step.buildId).catch(() => []) : Promise.resolve([]),
    ]);
    if (!planned) throw new StepFatalError("plan_missing", "The course plan for this build is missing.");
    const mod = planned.modules.find((m) => m.id === moduleId);
    if (!mod) throw new StepFatalError("module_missing", `Module ${moduleId} is not in the plan.`);

    const writer: WriterContext = {
      plan: planned,
      module: mod,
      pages: loaded.pages,
      sources: loaded.sources,
      studyGoal: build.studyGoal,
      outputLanguage: build.outputLanguage,
      attempt: step.attempts,
      figures: figuresForPages(allFigures, mod.pages),
      assetPrefix: `${step.buildId.slice(0, 8)}-`,
    };
    const single = !planned.planned;
    const tool = single ? "submit_course" : "submit_module";
    const savePreview = data.savePreview?.bind(data);
    const preview = savePreview ? previewWriter((p) => savePreview(step.id, ctx.owner, p), log) : null;
    let message: Anthropic.Message;
    let costUsd: number;
    try {
      ({ message, costUsd } = await meteredClaudeCall(
        metered,
        { buildId: step.buildId, stepId: step.id, userId: build.userId, purpose: `module:${mod.id}` },
        single ? singleModuleRequest(writer) : moduleRequest(writer),
        { signal: ctx.signal, onToolInput: preview ? (s) => preview.push(s) : undefined }
      ));
    } finally {
      preview?.stop();
    }
    const input = toolInput(message, tool) as Record<string, unknown>;
    const moduleTitle = single ? String(input.module_title ?? "").trim() : mod.title;
    const converted = toCourseModule(input, writer, moduleTitle);
    try {
      deps.validatePayload({ title: "check", description: "", modules: [converted.module] });
    } catch (err) {
      throw new ModuleOutputError(`Module ${mod.id} failed validation: ${err instanceof Error ? err.message : String(err)}`);
    }
    const output: ModuleStepOutput = {
      module: converted.module,
      notes: converted.notes,
      costUsd,
      ...(single
        ? {
            title: String(input.title ?? "").trim().slice(0, 140),
            description: String(input.description ?? "").trim().slice(0, 400),
          }
        : {}),
    };
    if (converted.notes.length) log("course-build module notes", { buildId: step.buildId, moduleId, notes: converted.notes });

    await serialized(step.buildId, async () => {
      const done = await data.listModuleOutputs(step.buildId);
      const modules = [...done.filter((d) => d.module.id !== mod.id).map((d) => d.module), output.module].sort(
        (a, b) => a.id - b.id
      );
      await data.publish({
        build,
        payload: {
          title: planned.title || output.title || "Untitled material",
          description: planned.description || output.description || "",
          modules,
        },
        final: false,
      });
    });
    return { output };
  };

  const finalize: StepHandler = async (step) => {
    const [build, planned, outputs] = await Promise.all([
      data.getBuild(step.buildId),
      data.getPlan(step.buildId),
      data.listModuleOutputs(step.buildId),
    ]);
    if (!planned) throw new StepFatalError("plan_missing", "The course plan for this build is missing.");
    const byId = new Map(outputs.map((o) => [o.module.id, o]));
    const missing = planned.modules.filter((m) => !byId.has(m.id)).map((m) => m.id);
    if (missing.length > 0) {
      throw new StepFatalError("module_missing", `Module ${missing.join(", ")} did not finish.`);
    }
    const first = outputs.find((o) => o.title);
    const payload: CoursePayload = {
      title: planned.title || first?.title || "Untitled material",
      description: planned.description || first?.description || "",
      modules: planned.modules.map((m) => byId.get(m.id)!.module),
    };
    // Stored as written (the parser would drop quiz difficulty); it only has to parse.
    try {
      deps.validatePayload(payload);
    } catch (err) {
      throw new StepFatalError(
        "invalid_course",
        `The finished course failed validation: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    const { sources, pages } = await loadPages(step.buildId);
    const materialId = await serialized(step.buildId, () =>
      data.publish({ build, payload, final: true, courseInfo: courseInfoFrom(planned, pages, sources) })
    );
    return { output: { materialId, modules: payload.modules.length } };
  };

  return { extract, plan, figures, module: writeModule, finalize };
}
