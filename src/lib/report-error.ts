import { createAdminClient } from "@/lib/supabase/admin";
import { isMissingDbColumnError } from "@/lib/supabase/schema-compat";

/**
 * Fire-and-forget server-side error reporting to the `error_events` table
 * (migration 077). For catch blocks that intentionally fail open (enrichment,
 * finalize, metering): the build/request continues, but the failure becomes
 * queryable instead of vanishing into function logs.
 *
 * Guarantees: never throws, never blocks the caller beyond the insert itself,
 * and degrades to console-only when the admin client or table is unavailable
 * (e.g. migration not applied yet).
 */
export async function report(
  scope: string,
  error: unknown,
  context?: {
    jobId?: string;
    userId?: string;
    detail?: Record<string, unknown>;
  }
): Promise<void> {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : JSON.stringify(error).slice(0, 2_000);

  console.error(`[report:${scope}]`, context?.jobId ?? "", error);

  try {
    const admin = createAdminClient();
    if (!admin) return;
    await admin.from("error_events").insert({
      scope,
      message: message.slice(0, 4_000),
      job_id: context?.jobId ?? null,
      user_id: context?.userId ?? null,
      detail: context?.detail ?? null,
    });
  } catch {
    // Reporting must never introduce a new failure path.
  }
}

/**
 * Record that an optional enrichment step failed open for this ingest job
 * (`pdf_ingest_jobs.degraded_reasons`). Deduplicated; tolerant of the column
 * not existing on an unmigrated database. Never throws.
 */
export async function addJobDegradedReason(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  jobId: string,
  reason: string
): Promise<void> {
  try {
    const { data, error: readErr } = await admin
      .from("pdf_ingest_jobs")
      .select("degraded_reasons")
      .eq("id", jobId)
      .maybeSingle();
    if (readErr) {
      if (!isMissingDbColumnError(readErr, "degraded_reasons")) {
        console.warn("[report] degraded_reasons read failed", jobId, readErr);
      }
      return;
    }
    const existing = Array.isArray(
      (data as { degraded_reasons?: unknown } | null)?.degraded_reasons
    )
      ? ((data as { degraded_reasons: unknown[] }).degraded_reasons.filter(
          (r): r is string => typeof r === "string"
        ) ?? [])
      : [];
    if (existing.includes(reason)) return;
    const { error: writeErr } = await admin
      .from("pdf_ingest_jobs")
      .update({ degraded_reasons: [...existing, reason] })
      .eq("id", jobId);
    if (writeErr && !isMissingDbColumnError(writeErr, "degraded_reasons")) {
      console.warn("[report] degraded_reasons write failed", jobId, writeErr);
    }
  } catch (e) {
    console.warn("[report] addJobDegradedReason", jobId, e);
  }
}
