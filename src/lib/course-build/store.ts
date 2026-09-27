/**
 * Typed access to the course-build database functions (migration 115).
 * Every method goes through one RPC so the same code runs against Supabase
 * in production and an in-process Postgres in tests.
 */

export type StepKind = "extract" | "plan" | "module" | "figures" | "finalize";
export type StepStatus = "pending" | "running" | "done" | "failed" | "canceled";
export type BuildTerminalStatus = "complete" | "failed" | "canceled";

export type StepRow = {
  id: string;
  buildId: string;
  kind: StepKind;
  ordinal: number;
  wave: number;
  status: StepStatus;
  attempts: number;
  maxAttempts: number;
  input: unknown;
  output: unknown;
};

export type NewStep = {
  kind: StepKind;
  ordinal: number;
  wave: number;
  input?: unknown;
  maxAttempts?: number;
};

export type BuildProgress = {
  buildStatus: string;
  cancelRequested: boolean;
  total: number;
  done: number;
  failed: number;
  ready: number;
  runningLive: number;
  waiting: number;
  nextRunAfter: Date | null;
};

export type ReserveSpendInput = {
  buildId: string;
  stepId: string | null;
  userId: string;
  purpose: string;
  model: string;
  maxOutputTokens: number;
  estCostUsd: number;
};

export type ReserveSpendResult = {
  ledgerId: string;
  ok: boolean;
  reason: string | null;
  buildCommittedUsd: number;
  buildCapUsd: number;
  dailyCommittedUsd: number;
  dailyCapUsd: number;
};

export type SettleSpendInput = {
  ledgerId: string;
  status: "settled" | "failed";
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  costUsd: number;
};

export type RpcResult = { data: unknown; error: { message: string } | null };
export type RpcFn = (fn: string, args: Record<string, unknown>) => PromiseLike<RpcResult>;

export class CourseBuildStoreError extends Error {
  constructor(fn: string, message: string) {
    super(`${fn}: ${message}`);
    this.name = "CourseBuildStoreError";
  }
}

type Row = Record<string, unknown>;

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : String(v ?? "");
}

function date(v: unknown): Date | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

function toStep(r: Row): StepRow {
  return {
    id: str(r.id),
    buildId: str(r.build_id),
    kind: str(r.kind) as StepKind,
    ordinal: num(r.ordinal),
    wave: num(r.wave),
    status: str(r.status) as StepStatus,
    attempts: num(r.attempts),
    maxAttempts: num(r.max_attempts),
    input: r.input ?? null,
    output: r.output ?? null,
  };
}

export class CourseBuildStore {
  private readonly rpc: RpcFn;

  constructor(rpc: RpcFn) {
    this.rpc = rpc;
  }

  private async rows(fn: string, args: Record<string, unknown>): Promise<Row[]> {
    let res: RpcResult;
    try {
      res = await this.rpc(fn, args);
    } catch (err) {
      throw new CourseBuildStoreError(fn, err instanceof Error ? err.message : String(err));
    }
    if (res.error) throw new CourseBuildStoreError(fn, res.error.message);
    if (res.data == null) return [];
    return (Array.isArray(res.data) ? res.data : [res.data]) as Row[];
  }

  private async one(fn: string, args: Record<string, unknown>): Promise<Row> {
    const rows = await this.rows(fn, args);
    if (!rows[0]) throw new CourseBuildStoreError(fn, "no row returned");
    return rows[0];
  }

  async claimBuildLease(buildId: string, owner: string, leaseSeconds: number): Promise<boolean> {
    const r = await this.one("course_build_claim_lease", {
      p_build_id: buildId,
      p_owner: owner,
      p_lease_seconds: leaseSeconds,
    });
    return r.ok === true;
  }

  async renewBuildLease(buildId: string, owner: string, leaseSeconds: number): Promise<boolean> {
    const r = await this.one("course_build_renew_lease", {
      p_build_id: buildId,
      p_owner: owner,
      p_lease_seconds: leaseSeconds,
    });
    return r.ok === true;
  }

  async releaseBuildLease(buildId: string, owner: string): Promise<boolean> {
    const r = await this.one("course_build_release_lease", { p_build_id: buildId, p_owner: owner });
    return r.ok === true;
  }

  async claimStep(buildId: string, owner: string, stepLeaseSeconds: number): Promise<StepRow | null> {
    const rows = await this.rows("course_build_claim_step", {
      p_build_id: buildId,
      p_owner: owner,
      p_step_lease_seconds: stepLeaseSeconds,
    });
    const r = rows[0];
    return r && r.id ? toStep(r) : null;
  }

  async renewStep(stepId: string, owner: string, stepLeaseSeconds: number): Promise<boolean> {
    const r = await this.one("course_build_renew_step", {
      p_step_id: stepId,
      p_owner: owner,
      p_step_lease_seconds: stepLeaseSeconds,
    });
    return r.ok === true;
  }

  async completeStep(stepId: string, owner: string, output: unknown, newSteps: NewStep[] = []): Promise<boolean> {
    const r = await this.one("course_build_complete_step", {
      p_step_id: stepId,
      p_owner: owner,
      p_output: output ?? null,
      p_new_steps: newSteps.map((s) => ({
        kind: s.kind,
        ordinal: s.ordinal,
        wave: s.wave,
        input: s.input ?? {},
        max_attempts: s.maxAttempts ?? null,
      })),
    });
    return r.ok === true;
  }

  async failStep(
    stepId: string,
    owner: string,
    error: string,
    retryable: boolean,
    backoffSeconds: number
  ): Promise<"retry" | "failed" | "stale"> {
    const r = await this.one("course_build_fail_step", {
      p_step_id: stepId,
      p_owner: owner,
      p_error: error,
      p_retryable: retryable,
      p_backoff_seconds: Math.max(0, Math.round(backoffSeconds)),
    });
    return str(r.outcome) as "retry" | "failed" | "stale";
  }

  async rescheduleStep(
    stepId: string,
    owner: string,
    delaySeconds: number,
    reason: string
  ): Promise<"rescheduled" | "failed" | "stale"> {
    const r = await this.one("course_build_reschedule_step", {
      p_step_id: stepId,
      p_owner: owner,
      p_delay_seconds: Math.max(1, Math.ceil(delaySeconds)),
      p_reason: reason,
    });
    return str(r.outcome) as "rescheduled" | "failed" | "stale";
  }

  async progress(buildId: string): Promise<BuildProgress | null> {
    const rows = await this.rows("course_build_progress", { p_build_id: buildId });
    const r = rows[0];
    if (!r) return null;
    return {
      buildStatus: str(r.build_status),
      cancelRequested: r.cancel_requested === true,
      total: num(r.total),
      done: num(r.done),
      failed: num(r.failed),
      ready: num(r.ready),
      runningLive: num(r.running_live),
      waiting: num(r.waiting),
      nextRunAfter: date(r.next_run_after),
    };
  }

  async finishBuild(
    buildId: string,
    owner: string,
    status: BuildTerminalStatus,
    errorCode: string | null = null,
    errorMessage: string | null = null
  ): Promise<{ ok: boolean; usageReservationId: string | null }> {
    const r = await this.one("course_build_finish", {
      p_build_id: buildId,
      p_owner: owner,
      p_status: status,
      p_error_code: errorCode,
      p_error_message: errorMessage,
    });
    return {
      ok: r.ok === true,
      usageReservationId: r.usage_reservation_id ? str(r.usage_reservation_id) : null,
    };
  }

  async buildsNeedingWork(limit: number): Promise<string[]> {
    const rows = await this.rows("course_builds_needing_work", { p_limit: limit });
    return rows.map((r) => str(r.build_id)).filter(Boolean);
  }

  async reserveSpend(input: ReserveSpendInput): Promise<ReserveSpendResult> {
    const r = await this.one("course_build_reserve_spend", {
      p_build_id: input.buildId,
      p_step_id: input.stepId,
      p_user_id: input.userId,
      p_purpose: input.purpose,
      p_model: input.model,
      p_max_output_tokens: input.maxOutputTokens,
      p_est_cost_usd: input.estCostUsd,
    });
    if (!r.ledger_id) throw new CourseBuildStoreError("course_build_reserve_spend", "no ledger id");
    return {
      ledgerId: str(r.ledger_id),
      ok: r.ok === true,
      reason: r.reason == null ? null : str(r.reason),
      buildCommittedUsd: num(r.build_committed_usd),
      buildCapUsd: num(r.build_cap_usd),
      dailyCommittedUsd: num(r.daily_committed_usd),
      dailyCapUsd: num(r.daily_cap_usd),
    };
  }

  async settleSpend(input: SettleSpendInput): Promise<boolean> {
    const r = await this.one("course_build_settle_spend", {
      p_ledger_id: input.ledgerId,
      p_status: input.status,
      p_input_tokens: input.inputTokens,
      p_output_tokens: input.outputTokens,
      p_cache_write_tokens: input.cacheWriteTokens,
      p_cache_read_tokens: input.cacheReadTokens,
      p_cost_usd: input.costUsd,
    });
    return r.ok === true;
  }
}
