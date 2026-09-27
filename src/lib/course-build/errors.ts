/** COURSE_BUILD_ENABLED is off. No AI call is made. */
export class CourseBuildDisabledError extends Error {
  readonly code = "disabled";
  constructor() {
    super("Course building is turned off right now.");
    this.name = "CourseBuildDisabledError";
  }
}

export type SpendRefusalReason = "build_cap" | "daily_cap" | "build_not_running";

/** The ledger refused the call because a cap would be passed. */
export class SpendRefusedError extends Error {
  readonly code: SpendRefusalReason;
  constructor(reason: SpendRefusalReason) {
    super(`AI call refused: ${reason}`);
    this.name = "SpendRefusedError";
    this.code = reason;
  }
}

/** The cap check itself could not run (DB error, unpriced model). The call is refused. */
export class BudgetUnavailableError extends Error {
  readonly code = "budget_unavailable";
  constructor(detail: string) {
    super(`AI spend check unavailable: ${detail}`);
    this.name = "BudgetUnavailableError";
  }
}

/** Anthropic rate limit / overload. The step is rescheduled, not retried in place. */
export class RateLimitedError extends Error {
  readonly code = "rate_limited";
  readonly retryAfterMs: number;
  constructor(retryAfterMs: number, detail: string) {
    super(detail);
    this.name = "RateLimitedError";
    this.retryAfterMs = retryAfterMs;
  }
}

/** Any other failed AI call. */
export class AiCallError extends Error {
  readonly code = "ai_call_failed";
  readonly retryable: boolean;
  readonly status: number | null;
  constructor(message: string, opts: { retryable: boolean; status: number | null }) {
    super(message);
    this.name = "AiCallError";
    this.retryable = opts.retryable;
    this.status = opts.status;
  }
}

/**
 * Thrown by step handlers for problems a retry cannot fix. `userMessage` is
 * shown to the student as-is, so it must name the actual problem.
 */
export class StepFatalError extends Error {
  readonly code: string;
  readonly userMessage: string;
  constructor(code: string, userMessage: string) {
    super(userMessage);
    this.name = "StepFatalError";
    this.code = code;
    this.userMessage = userMessage;
  }
}
