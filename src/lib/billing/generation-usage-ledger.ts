/**
 * Pure subscription generation/source-page ledger.
 * Database RPCs implement the same rules; this module is the testable
 * specification and the in-memory stand-in for unit tests.
 *
 * Reserved + completed count against caps. Released does not.
 * Deleting a course/content NEVER mutates this ledger.
 */

export type UsageStatus = "reserved" | "completed" | "released";

export type GenerationReason =
  | "initial"
  | "additional_material"
  | "full_regeneration";

export type GenerationUsageRow = {
  id: string;
  userId: string;
  billingPeriodStart: string;
  billingPeriodEnd: string | null;
  tierSnapshot: string;
  courseId: string | null;
  jobId: string | null;
  idempotencyKey: string;
  generationReason: GenerationReason;
  courseGenerationUnits: number;
  sourcePageUnits: number;
  status: UsageStatus;
  createdAt: string;
  completedAt: string | null;
  releasedAt: string | null;
};

export type UsageTotals = {
  courseGenerations: number;
  sourcePages: number;
};

export function usageCountsTowardCap(status: UsageStatus): boolean {
  return status === "reserved" || status === "completed";
}

export function sumUsage(
  rows: readonly GenerationUsageRow[],
  opts?: { userId?: string; periodStart?: string }
): UsageTotals {
  let courseGenerations = 0;
  let sourcePages = 0;
  for (const row of rows) {
    if (opts?.userId && row.userId !== opts.userId) continue;
    if (opts?.periodStart && row.billingPeriodStart !== opts.periodStart) {
      continue;
    }
    if (!usageCountsTowardCap(row.status)) continue;
    courseGenerations += Math.max(0, row.courseGenerationUnits);
    sourcePages += Math.max(0, row.sourcePageUnits);
  }
  return { courseGenerations, sourcePages };
}

export function remainingAfterUpgrade(opts: {
  used: number;
  previousCap: number;
  nextCap: number;
}): { used: number; cap: number; remaining: number } {
  const used = Math.max(0, opts.used);
  const cap = Math.max(0, opts.nextCap);
  return { used, cap, remaining: Math.max(0, cap - used) };
}

export type ReserveCourseGenerationInput = {
  userId: string;
  periodStart: string;
  periodEnd: string | null;
  tierSnapshot: string;
  courseId: string;
  jobId: string | null;
  idempotencyKey: string;
  reason: GenerationReason;
  generationUnits: number;
  cap: number;
  now?: string;
};

export type LedgerResult<T> =
  | { ok: true; row: T }
  | {
      ok: false;
      code:
        | "course_generation_cap_reached"
        | "source_page_cap_reached"
        | "already_reserved_initial"
        | "not_found"
        | "conflict";
      used: number;
      cap: number;
      remaining: number;
      error: string;
    };

export class InMemoryGenerationLedger {
  private rows = new Map<string, GenerationUsageRow>();
  private seq = 0;

  snapshot(): GenerationUsageRow[] {
    return [...this.rows.values()].map((r) => ({ ...r }));
  }

  get(id: string): GenerationUsageRow | undefined {
    const row = this.rows.get(id);
    return row ? { ...row } : undefined;
  }

  totals(userId: string, periodStart: string): UsageTotals {
    return sumUsage(this.snapshot(), { userId, periodStart });
  }

  /**
   * Atomically reserve course-generation units. Idempotent on idempotencyKey
   * and on jobId (retries of the same job reuse the row).
   */
  reserveCourseGeneration(
    input: ReserveCourseGenerationInput
  ): LedgerResult<GenerationUsageRow> {
    const existingKey = [...this.rows.values()].find(
      (r) =>
        r.userId === input.userId && r.idempotencyKey === input.idempotencyKey
    );
    if (existingKey) return { ok: true, row: { ...existingKey } };

    if (input.jobId) {
      const byJob = [...this.rows.values()].find(
        (r) =>
          r.jobId === input.jobId && usageCountsTowardCap(r.status)
      );
      if (byJob) return { ok: true, row: { ...byJob } };
    }

    if (
      input.reason === "initial" &&
      input.generationUnits > 0
    ) {
      const existingInitial = [...this.rows.values()].find(
        (r) =>
          r.courseId === input.courseId &&
          r.generationReason === "initial" &&
          r.courseGenerationUnits > 0 &&
          usageCountsTowardCap(r.status)
      );
      if (existingInitial) {
        return { ok: true, row: { ...existingInitial } };
      }
    }

    const used = this.totals(input.userId, input.periodStart).courseGenerations;
    const units = Math.max(0, input.generationUnits);
    if (units > 0 && used + units > input.cap) {
      return {
        ok: false,
        code: "course_generation_cap_reached",
        used,
        cap: input.cap,
        remaining: Math.max(0, input.cap - used),
        error: "course_generation_cap_reached",
      };
    }

    const now = input.now ?? new Date().toISOString();
    const row: GenerationUsageRow = {
      id: `usage_${++this.seq}`,
      userId: input.userId,
      billingPeriodStart: input.periodStart,
      billingPeriodEnd: input.periodEnd,
      tierSnapshot: input.tierSnapshot,
      courseId: input.courseId,
      jobId: input.jobId,
      idempotencyKey: input.idempotencyKey,
      generationReason: input.reason,
      courseGenerationUnits: units,
      sourcePageUnits: 0,
      status: "reserved",
      createdAt: now,
      completedAt: null,
      releasedAt: null,
    };
    this.rows.set(row.id, row);
    return { ok: true, row: { ...row } };
  }

  reserveSourcePages(opts: {
    reservationId: string;
    sourcePageUnits: number;
    cap: number;
    userId: string;
    periodStart: string;
  }): LedgerResult<GenerationUsageRow> {
    const row = this.rows.get(opts.reservationId);
    if (!row || row.status === "released") {
      return {
        ok: false,
        code: "not_found",
        used: 0,
        cap: opts.cap,
        remaining: opts.cap,
        error: "reservation_not_found",
      };
    }

    const others = this.totals(opts.userId, opts.periodStart).sourcePages -
      (usageCountsTowardCap(row.status) ? row.sourcePageUnits : 0);
    const pages = Math.max(0, Math.trunc(opts.sourcePageUnits));
    if (others + pages > opts.cap) {
      return {
        ok: false,
        code: "source_page_cap_reached",
        used: others,
        cap: opts.cap,
        remaining: Math.max(0, opts.cap - others),
        error: "source_page_cap_reached",
      };
    }

    row.sourcePageUnits = pages;
    this.rows.set(row.id, row);
    return { ok: true, row: { ...row } };
  }

  finalize(reservationId: string, now = new Date().toISOString()): LedgerResult<GenerationUsageRow> {
    const row = this.rows.get(reservationId);
    if (!row) {
      return {
        ok: false,
        code: "not_found",
        used: 0,
        cap: 0,
        remaining: 0,
        error: "reservation_not_found",
      };
    }
    if (row.status === "released") {
      return {
        ok: false,
        code: "conflict",
        used: 0,
        cap: 0,
        remaining: 0,
        error: "already_released",
      };
    }
    row.status = "completed";
    row.completedAt = now;
    this.rows.set(row.id, row);
    return { ok: true, row: { ...row } };
  }

  release(reservationId: string, now = new Date().toISOString()): LedgerResult<GenerationUsageRow> {
    const row = this.rows.get(reservationId);
    if (!row) {
      return {
        ok: false,
        code: "not_found",
        used: 0,
        cap: 0,
        remaining: 0,
        error: "reservation_not_found",
      };
    }
    if (row.status === "completed") {
      return { ok: true, row: { ...row } };
    }
    row.status = "released";
    row.releasedAt = now;
    this.rows.set(row.id, row);
    return { ok: true, row: { ...row } };
  }

  /** Content delete must call NOTHING on this ledger. Exposed for tests. */
  deleteCourse(): void {
    // Intentionally empty — deleting a course never refunds usage.
  }
}

export function initialGenerationIdempotencyKey(courseId: string): string {
  return `initial:${courseId}`;
}

export function jobGenerationIdempotencyKey(jobId: string): string {
  return `job:${jobId}`;
}

export function additionalMaterialIdempotencyKey(jobId: string): string {
  return `additional:${jobId}`;
}
