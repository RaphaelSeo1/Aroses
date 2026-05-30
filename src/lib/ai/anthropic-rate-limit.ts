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
  // Clamp a single call's estimate to the window cap so one big request can't
  // deadlock itself against the budget.
  const estOutput = Math.min(opts.estOutputTokens, maxOutput);
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
