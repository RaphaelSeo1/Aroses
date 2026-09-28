import Anthropic from "@anthropic-ai/sdk";
import { parseCoursePayload } from "@/lib/ai/course-payload";
import { createAdminClient } from "@/lib/supabase/admin";
import { readCourseBuildConfig } from "./config.ts";
import { createFigureFinder, createSourceExtractor } from "./extract-source.ts";
import { makeContactSheet } from "./figures-pdf.ts";
import { createStepHandlers, type BuildData } from "./handlers.ts";
import { driveBuild, sweepBuilds, type DriveOptions, type DriveOutcome } from "./runner.ts";
import { createSupabaseBuildData } from "./supabase-build-data.ts";
import { CourseBuildStore } from "./store.ts";

export type RunOptions = Pick<DriveOptions, "deadlineAt" | "onTerminal" | "log" | "concurrency"> & {
  reservePages?: BuildData["reservePages"];
};

function setup({ log, reservePages }: RunOptions) {
  const admin = createAdminClient();
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!admin) throw new Error("Supabase service role is not configured");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  const config = readCourseBuildConfig();
  const store = new CourseBuildStore((fn, args) => admin.rpc(fn, args));
  const handlers = createStepHandlers({
    store,
    client: new Anthropic({ apiKey, maxRetries: 0 }),
    config,
    data: { ...createSupabaseBuildData(admin), reservePages },
    extract: createSourceExtractor(admin),
    findFigures: config.figuresEnabled ? createFigureFinder(admin, { maxRenderPages: config.figureMaxPages, timeBudgetMs: config.figureTimeBudgetMs }) : undefined,
    makeContactSheet,
    validatePayload: parseCoursePayload,
    log,
  });
  return { store, handlers };
}

/** Works a build until it finishes, hits the deadline, or has to wait. */
export async function runCourseBuild(buildId: string, opts: RunOptions = {}): Promise<DriveOutcome> {
  const { store, handlers } = setup(opts);
  return driveBuild({ buildId, store, handlers, concurrency: 8, maxIdleWaitMs: 15_000, ...opts });
}

/** Recovery pass for builds whose worker died or whose retries are due. */
export async function sweepCourseBuilds(opts: RunOptions & { limit?: number } = {}) {
  const { store, handlers } = setup(opts);
  return sweepBuilds({ store, handlers, concurrency: 8, maxIdleWaitMs: 15_000, ...opts });
}
