import { randomUUID } from "node:crypto";
import {
  AiCallError,
  BudgetUnavailableError,
  CourseBuildDisabledError,
  RateLimitedError,
  SpendRefusedError,
  StepFatalError,
} from "./errors.ts";
import type { BuildTerminalStatus, CourseBuildStore, NewStep, StepKind, StepRow } from "./store.ts";

export type StepContext = {
  buildId: string;
  owner: string;
  /** Aborted when the build is canceled or this worker loses its lease. */
  signal: AbortSignal;
};

export type StepResult = {
  output: unknown;
  /** Follow-up steps, saved in the same transaction as this step's result. */
  newSteps?: NewStep[];
};

export type StepHandler = (step: StepRow, ctx: StepContext) => Promise<StepResult>;
export type StepHandlers = Partial<Record<StepKind, StepHandler>>;

export type TerminalEvent = {
  buildId: string;
  status: BuildTerminalStatus;
  usageReservationId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
};

export type DriveOptions = {
  buildId: string;
  store: CourseBuildStore;
  handlers: StepHandlers;
  /** Billing finalize/release and student notification. Runs once per build. */
  onTerminal?: (event: TerminalEvent) => Promise<void>;
  owner?: string;
  concurrency?: number;
  /** Stop claiming new steps after this epoch-ms time; in-flight steps finish. */
  deadlineAt?: number;
  buildLeaseSeconds?: number;
  stepLeaseSeconds?: number;
  heartbeatMs?: number;
  /** Seconds to wait before retry N (1-based) of a failed step. */
  backoffSeconds?: (attempt: number) => number;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
};

export type DriveOutcome =
  | { outcome: "finished"; status: BuildTerminalStatus }
  /** Another worker holds the lease, or the build is already finished. */
  | { outcome: "not_claimed" }
  /** Stopped early (deadline, or every remaining step is scheduled for later). */
  | { outcome: "yielded"; nextRunAfter: Date | null }
  | { outcome: "lease_lost" };

const DEFAULT_BACKOFF = (attempt: number) => Math.min(60, 5 * 2 ** Math.max(0, attempt - 1));

type Fatal = { code: string; message: string };

const STEP_LABEL: Record<StepKind, string> = {
  extract: "Reading your files",
  plan: "Planning the course",
  module: "Writing a module",
  figures: "Adding figures",
  finalize: "Finishing the course",
};

function describeStep(step: StepRow): string {
  if (step.kind === "module") return `Writing module ${step.ordinal + 1}`;
  return STEP_LABEL[step.kind] ?? "A build step";
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function spendRefusalMessage(reason: string): string {
  if (reason === "daily_cap") {
    return "You've reached today's course-building limit. Try again in 24 hours.";
  }
  if (reason === "build_not_running") return "This build was stopped.";
  return "This build hit its spending limit before it finished. Try splitting the file into smaller parts.";
}

/**
 * Runs one build until it finishes, the deadline passes, or nothing is ready.
 * Only the lease holder claims steps, each step's result is saved as soon as
 * it finishes, and a crashed worker's steps are picked up once their leases
 * expire.
 */
export async function driveBuild(opts: DriveOptions): Promise<DriveOutcome> {
  const {
    buildId,
    store,
    handlers,
    onTerminal,
    concurrency = 8,
    deadlineAt = Number.POSITIVE_INFINITY,
    buildLeaseSeconds = 90,
    stepLeaseSeconds = 180,
    heartbeatMs = 20_000,
    backoffSeconds = DEFAULT_BACKOFF,
    log = () => {},
  } = opts;
  const owner = opts.owner ?? `cb-${randomUUID()}`;

  if (!(await store.claimBuildLease(buildId, owner, buildLeaseSeconds))) {
    return { outcome: "not_claimed" };
  }

  const inflight = new Map<string, { promise: Promise<void>; abort: AbortController }>();
  let leaseLost = false;
  let canceled = false;
  let fatal = null as Fatal | null;
  let finished = false;

  const abortAll = () => {
    for (const { abort } of inflight.values()) abort.abort();
  };

  const heartbeat = setInterval(() => {
    void (async () => {
      try {
        if (!(await store.renewBuildLease(buildId, owner, buildLeaseSeconds))) {
          leaseLost = true;
          abortAll();
          return;
        }
        for (const stepId of inflight.keys()) {
          await store.renewStep(stepId, owner, stepLeaseSeconds);
        }
        const p = await store.progress(buildId);
        if (p?.cancelRequested) {
          canceled = true;
          abortAll();
        }
      } catch (err) {
        log("course-build heartbeat failed", { buildId, error: errMessage(err) });
      }
    })();
  }, heartbeatMs);
  (heartbeat as { unref?: () => void }).unref?.();

  const finish = async (status: BuildTerminalStatus, code: string | null, message: string | null) => {
    const res = await store.finishBuild(buildId, owner, status, code, message);
    finished = true;
    if (!res.ok || !onTerminal) return;
    try {
      await onTerminal({
        buildId,
        status,
        usageReservationId: res.usageReservationId,
        errorCode: code,
        errorMessage: message,
      });
    } catch (err) {
      log("course-build onTerminal failed", { buildId, status, error: errMessage(err) });
    }
  };

  const runStep = async (step: StepRow, abort: AbortController) => {
    const handler = handlers[step.kind];
    try {
      if (!handler) throw new StepFatalError("no_handler", `${describeStep(step)} is not available yet.`);
      const result = await handler(step, { buildId, owner, signal: abort.signal });
      const saved = await store.completeStep(step.id, owner, result.output ?? null, result.newSteps ?? []);
      if (!saved) log("course-build step result discarded (no longer owned)", { buildId, stepId: step.id });
    } catch (err) {
      await handleStepError(step, err);
    }
  };

  const handleStepError = async (step: StepRow, err: unknown) => {
    const detail = errMessage(err);
    try {
      if (canceled || leaseLost) {
        await store.failStep(step.id, owner, detail, true, 0);
        return;
      }
      if (err instanceof RateLimitedError) {
        const out = await store.rescheduleStep(step.id, owner, err.retryAfterMs / 1000, detail);
        if (out === "failed") {
          fatal ??= { code: "rate_limited", message: "The AI service stayed busy for too long. Try again in a few minutes." };
        }
        return;
      }
      if (err instanceof SpendRefusedError) {
        await store.failStep(step.id, owner, detail, false, 0);
        fatal ??= { code: err.code, message: spendRefusalMessage(err.code) };
        return;
      }
      if (err instanceof CourseBuildDisabledError) {
        await store.failStep(step.id, owner, detail, false, 0);
        fatal ??= { code: err.code, message: "Course building was turned off while this build was running." };
        return;
      }
      if (err instanceof StepFatalError) {
        await store.failStep(step.id, owner, detail, false, 0);
        fatal ??= { code: err.code, message: err.userMessage };
        return;
      }
      const retryable = err instanceof AiCallError ? err.retryable : true;
      const out = await store.failStep(step.id, owner, detail, retryable, backoffSeconds(step.attempts));
      if (out === "failed") {
        const code = err instanceof BudgetUnavailableError ? err.code : "step_failed";
        fatal ??= {
          code,
          message: `${describeStep(step)} failed after ${step.attempts} ${step.attempts === 1 ? "try" : "tries"}.`,
        };
      }
    } catch (storeErr) {
      // Leave the step running; its lease expires and it is retried or failed then.
      log("course-build could not record step failure", {
        buildId,
        stepId: step.id,
        error: errMessage(storeErr),
      });
    }
  };

  let emptyClaims = 0;
  try {
    for (;;) {
      if (leaseLost) return { outcome: "lease_lost" };

      while (!fatal && !canceled && !leaseLost && Date.now() < deadlineAt && inflight.size < concurrency) {
        const step = await store.claimStep(buildId, owner, stepLeaseSeconds);
        if (!step) break;
        emptyClaims = 0;
        const abort = new AbortController();
        const promise = runStep(step, abort).finally(() => inflight.delete(step.id));
        inflight.set(step.id, { promise, abort });
      }

      if (inflight.size > 0) {
        await Promise.race([...inflight.values()].map((x) => x.promise));
        continue;
      }

      if (leaseLost) return { outcome: "lease_lost" };

      const p = await store.progress(buildId);
      if (!p) return { outcome: "lease_lost" };

      if (canceled || p.cancelRequested) {
        await finish("canceled", "canceled", null);
        return { outcome: "finished", status: "canceled" };
      }
      if (fatal) {
        await finish("failed", fatal.code, fatal.message);
        return { outcome: "finished", status: "failed" };
      }
      if (p.failed > 0) {
        await finish("failed", "step_failed", "A build step failed and could not be retried.");
        return { outcome: "finished", status: "failed" };
      }
      if (p.total === 0) {
        await finish("failed", "no_steps", "This build has nothing to do.");
        return { outcome: "finished", status: "failed" };
      }
      if (p.done === p.total) {
        await finish("complete", null, null);
        return { outcome: "finished", status: "complete" };
      }
      if (p.ready > 0 && Date.now() < deadlineAt && emptyClaims < 3) {
        emptyClaims += 1;
        continue;
      }
      return { outcome: "yielded", nextRunAfter: p.nextRunAfter };
    }
  } finally {
    clearInterval(heartbeat);
    if (inflight.size > 0) {
      abortAll();
      await Promise.allSettled([...inflight.values()].map((x) => x.promise));
    }
    if (!finished && !leaseLost) {
      await store.releaseBuildLease(buildId, owner).catch((err) => {
        log("course-build lease release failed", { buildId, error: errMessage(err) });
      });
    }
  }
}

/**
 * Cron recovery: drives every build whose worker died or whose rescheduled
 * steps are now due. Builds are driven one after another so a single tick
 * never runs two workers for the same build.
 */
export async function sweepBuilds(
  opts: Omit<DriveOptions, "buildId"> & { limit?: number }
): Promise<Array<{ buildId: string; result: DriveOutcome }>> {
  const ids = await opts.store.buildsNeedingWork(opts.limit ?? 10);
  const results: Array<{ buildId: string; result: DriveOutcome }> = [];
  for (const buildId of ids) {
    if (opts.deadlineAt != null && Date.now() >= opts.deadlineAt) break;
    try {
      results.push({ buildId, result: await driveBuild({ ...opts, buildId }) });
    } catch (err) {
      opts.log?.("course-build sweep drive failed", { buildId, error: errMessage(err) });
    }
  }
  return results;
}
