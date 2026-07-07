import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Per-call Claude usage ledger (`ai_usage_events`, migration 078).
 *
 * The shared AI wrappers (`createMessageWithRetries`, the ingest streaming
 * reader, `runStudyChat`, `streamVoiceReply`, …) call `recordAiUsage` with the
 * token counts already present on every Anthropic response. Attribution
 * (user/job/feature) comes from an AsyncLocalStorage context set once at each
 * entry point (API route or ingest runner), so the wrappers themselves stay
 * signature-compatible and deeply nested call sites need no plumbing.
 *
 * Everything here is fire-and-forget telemetry: it never throws, never blocks
 * the AI call, and silently no-ops when the admin client or table is missing.
 */

export type AiUsageContext = {
  userId?: string | null;
  jobId?: string | null;
  feature?: string;
};

const usageContext = new AsyncLocalStorage<AiUsageContext>();

/**
 * Attribute all `recordAiUsage` calls for the remainder of the current async
 * execution (route handler body, ingest job run, …) to this user/job/feature.
 */
export function enterAiUsageContext(ctx: AiUsageContext): void {
  try {
    usageContext.enterWith(ctx);
  } catch {
    // Never let telemetry setup break the caller.
  }
}

export function recordAiUsage(entry: {
  model: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  feature?: string;
  userId?: string | null;
  jobId?: string | null;
}): void {
  try {
    const ctx = usageContext.getStore();
    const admin = createAdminClient();
    if (!admin) return;
    void admin
      .from("ai_usage_events")
      .insert({
        user_id: entry.userId ?? ctx?.userId ?? null,
        job_id: entry.jobId ?? ctx?.jobId ?? null,
        feature: entry.feature ?? ctx?.feature ?? "unknown",
        model: entry.model,
        input_tokens: Math.max(0, Math.trunc(entry.inputTokens ?? 0)),
        output_tokens: Math.max(0, Math.trunc(entry.outputTokens ?? 0)),
      })
      .then(
        () => {},
        () => {}
      );
  } catch {
    // Telemetry only — never a new failure path.
  }
}
