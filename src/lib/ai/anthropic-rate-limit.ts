import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Global, DB-backed Claude rate limiter.
 *
 * Every course-build Claude call reserves an estimated token/request budget in
 * a shared per-minute window (`claude_rate_usage` + `claude_rate_try_acquire`).
 * This replaces the old "max 3 concurrent jobs per user" heuristic that was
 * tuned for Anthropic Tier 1 and left most jobs queued on higher tiers.
 *
 * Sizing: defaults are conservative-but-better-than-Tier-1. Bump these env vars
 * to match your org's real limits (Anthropic console -> Settings -> Limits):
 *   CLAUDE_MAX_RPM   requests / minute     (default 600)
 *   CLAUDE_MAX_ITPM  input tokens / minute (default 320000)
 *   CLAUDE_MAX_OTPM  output tokens / minute(default 56000)
 *
 * Fail-open: if the admin client, table, or RPC is unavailable (e.g. migration
 * not yet applied) we proceed without gating. The reactive 429 backoff in the
 * runner remains as a backstop, so builds never hard-break on the limiter.
 */

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function budget(): { maxRequests: number; maxInput: number; maxOutput: number } {
  return {
    maxRequests: intEnv("CLAUDE_MAX_RPM", 600),
    maxInput: intEnv("CLAUDE_MAX_ITPM", 320_000),
    maxOutput: intEnv("CLAUDE_MAX_OTPM", 56_000),
  };
}

function floatEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Callers reserve `max_tokens` as the worst-case output, but a typical
 * lesson/module/outline call emits far fewer tokens than its cap (e.g. a `full`
 * module reserves 30,720 yet usually returns ~8–15k). Reserving the worst case
 * throttles concurrency ~2–3× below what the org OTPM actually allows, so module
 * batches serialize through the limiter even when the account has spare budget.
 *
 * We scale the *output* reservation by this ratio (input is already estimated
 * from real prompt size, so it is left intact). The reactive 429 backoff in the
 * runner backstops any rare overshoot. Lower = more concurrency / faster builds
 * but more 429 pressure; raise toward 1.0 to be conservative. Floor keeps tiny
 * calls reserving something. Tune with `CLAUDE_OUTPUT_RESERVE_RATIO` /
 * `CLAUDE_OUTPUT_RESERVE_FLOOR`.
 */
function outputReserveRatio(): number {
  return Math.min(1, Math.max(0.1, floatEnv("CLAUDE_OUTPUT_RESERVE_RATIO", 0.5)));
}

function outputReserveFloor(): number {
  return intEnv("CLAUDE_OUTPUT_RESERVE_FLOOR", 2_000);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Rough token estimate from text (~4 chars/token), with a small floor. */
function estimateInputTokens(
  messages: { content: unknown }[] | undefined
): number {
  if (!messages) return 1_000;
  let chars = 0;
  for (const m of messages) {
    if (typeof m.content === "string") {
      chars += m.content.length;
    } else if (Array.isArray(m.content)) {
      for (const block of m.content) {
        const text = (block as { text?: unknown })?.text;
        if (typeof text === "string") chars += text.length;
      }
    }
  }
  return Math.max(500, Math.ceil(chars / 4));
}

type AcquireOpts = {
  /** Worst-case output tokens this call may produce (use the request max_tokens). */
  estOutputTokens: number;
  /** Estimated input tokens; pass messages instead to auto-estimate. */
  estInputTokens?: number;
  messages?: { content: unknown }[];
  /** Max time to wait for budget before proceeding anyway (default 90s). */
  maxWaitMs?: number;
};

/**
 * Reserve global Claude budget before issuing a request. Resolves when budget
 * is granted, or after `maxWaitMs` (proceed anyway — reactive 429 retries cover
 * the rare overshoot). Never throws; fails open on any limiter error.
 */
export async function acquireClaudeBudget(opts: AcquireOpts): Promise<void> {
  const admin = createAdminClient();
  if (!admin) return; // no shared store -> can't coordinate -> fail open

  const { maxRequests, maxInput, maxOutput } = budget();
  const estInput =
    opts.estInputTokens ?? estimateInputTokens(opts.messages);
  // Scale the worst-case output reservation down to a realistic level so module
  // batches aren't artificially serialized (see `outputReserveRatio`), then
  // clamp to the window cap so one big request can't deadlock itself.
  const scaledOutput = Math.max(
    Math.min(opts.estOutputTokens, outputReserveFloor()),
    Math.round(opts.estOutputTokens * outputReserveRatio())
  );
  const estOutput = Math.min(scaledOutput, maxOutput);
  const deadline = Date.now() + (opts.maxWaitMs ?? 90_000);

  for (;;) {
    let granted = false;
    let retryAfterMs = 1_000;
    try {
      const { data, error } = await admin.rpc("claude_rate_try_acquire", {
        p_est_input: estInput,
        p_est_output: estOutput,
        p_max_requests: maxRequests,
        p_max_input: maxInput,
        p_max_output: maxOutput,
      });
      if (error) return; // RPC/table missing -> fail open
      const row = Array.isArray(data) ? data[0] : data;
      granted = Boolean(row?.granted);
      const ra = Number(row?.retry_after_ms);
      if (Number.isFinite(ra) && ra > 0) retryAfterMs = ra;
    } catch {
      return; // fail open
    }

    if (granted) return;

    const jitter = Math.floor(Math.random() * 400);
    const wait = Math.min(retryAfterMs, 5_000) + jitter;
    if (Date.now() + wait >= deadline) return; // proceed; backstop handles overshoot
    await sleep(wait);
  }
}
