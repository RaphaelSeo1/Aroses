import type Anthropic from "@anthropic-ai/sdk";
import type { CourseModule, CoursePayload } from "@/types/course";
import { cleanPages, paginateText, type SourcePage } from "./clean.ts";
import type { CourseBuildConfig } from "./config.ts";
import { AiCallError, StepFatalError } from "./errors.ts";
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

export type BuildRecord = {
  id: string;
  userId: string;
  courseId: string;
  examGroupId: string | null;
  materialId: string | null;
  outputLanguage: string | null;
  studyGoal: string | null;
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
  /** Final gate: the payload must parse exactly as the viewers parse it. */
  validatePayload: (payload: unknown) => CoursePayload;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
};

type ExtractInput = { sourceId: string; text?: string };
type ModuleInput = { moduleId: number };

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

    let raw: SourcePage[];
    if (TEXT_KINDS.has(source.kind)) {
      raw = paginateText(input.text ?? "");
    } else {
      raw = await deps.extract(source);
    }
    const pages = TEXT_KINDS.has(source.kind) ? raw : cleanPages(raw);
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

  const writeModule: StepHandler = async (step, ctx) => {
    const { moduleId } = (step.input ?? {}) as ModuleInput;
    const [build, planned, loaded] = await Promise.all([
      data.getBuild(step.buildId),
      data.getPlan(step.buildId),
      loadPages(step.buildId),
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
    };
    const single = !planned.planned;
    const tool = single ? "submit_course" : "submit_module";
    const { message, costUsd } = await meteredClaudeCall(
      metered,
      { buildId: step.buildId, stepId: step.id, userId: build.userId, purpose: `module:${mod.id}` },
      single ? singleModuleRequest(writer) : moduleRequest(writer),
      { signal: ctx.signal }
    );
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

  return { extract, plan, module: writeModule, finalize };
}
