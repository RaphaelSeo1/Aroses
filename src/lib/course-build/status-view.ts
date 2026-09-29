import type { CourseModule } from "@/types/course";
import type { ModulePreview } from "./handlers.ts";

export type BuildStage = "reading" | "planning" | "figures" | "writing" | "finishing" | "done" | "failed" | "canceled";

export type StepView = {
  kind: string;
  ordinal: number;
  status: string;
  attempts: number;
  run_after: string | null;
  preview: ModulePreview | null;
  /** Times the step was put back because the AI service was busy. */
  rate_limited_count?: number | null;
  /** Server-side only: never sent to the browser. */
  last_error?: string | null;
};

type BuildRow = {
  id: string;
  status: string;
  course_id: string;
  exam_group_id: string | null;
  material_id: string | null;
  plan: unknown;
  source_pages: number | null;
  error_code: string | null;
  error_message: string | null;
  cancel_requested_at: string | null;
  first_module_at: string | null;
  completed_at: string | null;
  created_at: string;
};

export type PlanView = {
  title: string;
  description: string;
  modules: Array<{ id: number; title: string; lessons: string[] }>;
};

export type ModuleProgress = {
  id: number;
  status: "waiting" | "writing" | "retrying" | "done" | "failed";
  preview: ModulePreview | null;
};

export type BuildStatus = {
  id: string;
  status: string;
  stage: BuildStage;
  courseId: string;
  sectionId: string | null;
  materialId: string | null;
  title: string | null;
  plan: PlanView | null;
  progress: ModuleProgress[];
  modulesDone: number;
  modulesTotal: number;
  /** Finished modules not in the caller's `have` list. */
  modules: CourseModule[];
  sources: Array<{ label: string; kind: string; pages: number | null }>;
  sourcePages: number;
  /** Null when the build doesn't look for figures (no PDFs). */
  figures: { done: boolean; found: number } | null;
  canceling: boolean;
  /** A step is waiting to retry because the AI service turned it away. */
  aiBusy: boolean;
  error: { code: string | null; message: string } | null;
  createdAt: string;
  firstModuleAt: string | null;
  completedAt: string | null;
};

function planView(raw: unknown): PlanView | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as { title?: unknown; description?: unknown; modules?: unknown };
  const modules = Array.isArray(p.modules)
    ? p.modules.map((m: { id?: unknown; title?: unknown; lessons?: unknown }) => ({
        id: Number(m.id),
        title: typeof m.title === "string" ? m.title : "",
        lessons: Array.isArray(m.lessons) ? m.lessons.filter((l): l is string => typeof l === "string") : [],
      }))
    : [];
  return {
    title: typeof p.title === "string" ? p.title : "",
    description: typeof p.description === "string" ? p.description : "",
    modules,
  };
}

function stageOf(status: string, steps: StepView[]): BuildStage {
  if (status === "complete") return "done";
  if (status === "failed") return "failed";
  if (status === "canceled") return "canceled";
  const open = (kind: string) => steps.some((s) => s.kind === kind && s.status !== "done");
  if (open("extract")) return "reading";
  if (!steps.some((s) => s.kind === "plan" && s.status === "done")) return "planning";
  if (open("figures")) return "figures";
  if (open("module")) return "writing";
  return "finishing";
}

function moduleStatus(step: StepView, now: number): ModuleProgress["status"] {
  if (step.status === "done") return "done";
  if (step.status === "failed" || step.status === "canceled") return "failed";
  if (step.status === "running") return step.attempts > 1 ? "retrying" : "writing";
  const later = step.run_after ? Date.parse(step.run_after) > now : false;
  return step.attempts > 0 || later ? "retrying" : "waiting";
}

const BUSY_ERROR = /overloaded|rate.?limit|\b(429|503|529)\b|temporarily unavailable/i;

/** Build-cap waits are rescheduled the same way, so the saved error decides. */
function waitingOnBusyAi(step: StepView, now: number): boolean {
  if (step.status !== "pending" || !step.rate_limited_count) return false;
  if (!step.run_after || Date.parse(step.run_after) <= now - 5_000) return false;
  return BUSY_ERROR.test(step.last_error ?? "");
}

/** What the build screen shows, derived from the saved build and steps only. */
export function buildStatusView(input: {
  build: BuildRow;
  steps: StepView[];
  sources: Array<{ label: string; kind: string; page_count: number | null }>;
  materialTitle: string | null;
  modules: CourseModule[];
  figuresFound?: number;
  now?: number;
}): BuildStatus {
  const { build, steps } = input;
  const now = input.now ?? Date.now();
  const plan = planView(build.plan);
  const moduleSteps = steps.filter((s) => s.kind === "module").sort((a, b) => a.ordinal - b.ordinal);
  const figureSteps = steps.filter((s) => s.kind === "figures");
  const progress = moduleSteps.map((s) => {
    const status = moduleStatus(s, now);
    return { id: s.ordinal + 1, status, preview: status === "done" ? null : s.preview };
  });
  // A single-module plan is never planned by the model, so its module title
  // only exists in the writer's output.
  if (plan && !plan.title) {
    for (const m of plan.modules) {
      const written = progress.find((p) => p.id === m.id)?.preview?.moduleTitle || input.modules.find((x) => x.id === m.id)?.title;
      if (written) m.title = written;
    }
  }
  const title = plan?.title || input.materialTitle || progress.find((p) => p.preview?.title)?.preview?.title || null;
  const terminal = ["complete", "failed", "canceled"].includes(build.status);
  return {
    id: build.id,
    status: build.status,
    stage: stageOf(build.status, steps),
    courseId: build.course_id,
    sectionId: build.exam_group_id,
    materialId: build.status === "failed" || build.status === "canceled" ? null : build.material_id,
    title,
    plan,
    progress,
    modulesDone: progress.filter((p) => p.status === "done").length,
    modulesTotal: plan?.modules.length ?? progress.length,
    modules: build.status === "failed" || build.status === "canceled" ? [] : input.modules,
    sources: input.sources.map((s) => ({ label: s.label, kind: s.kind, pages: s.page_count })),
    sourcePages: build.source_pages ?? 0,
    figures: figureSteps.length
      ? { done: figureSteps.every((s) => s.status === "done"), found: input.figuresFound ?? 0 }
      : null,
    canceling: !terminal && !!build.cancel_requested_at,
    aiBusy: !terminal && steps.some((s) => waitingOnBusyAi(s, now)),
    error:
      build.status === "failed"
        ? { code: build.error_code, message: build.error_message || "The build failed. Try again in a few minutes." }
        : null,
    createdAt: build.created_at,
    firstModuleAt: build.first_module_at,
    completedAt: build.completed_at,
  };
}
