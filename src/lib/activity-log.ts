import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Canonical admin audit-log event types.
 *
 * `course_created` and `user_signed_up` are intentionally NOT here: those are
 * still *derived* from the `courses` table and the Auth user list in
 * `admin-dashboard-data.ts`, so we get their full history for free without
 * needing to have logged them. Everything else is recorded into
 * `public.activity_events` as it happens.
 */
export type ActivityEventType =
  | "sign_in"
  | "sign_out"
  | "course_built"
  | "course_deleted"
  | "voice_tutor_started"
  | "voice_tutor_ended"
  | "module_completed"
  | "quiz_submitted"
  | "onboarding_completed"
  | "listing_submitted"
  | "listing_approved"
  | "listing_rejected"
  | "course_purchased";

/** Event types a signed-in browser is allowed to report via /api/activity/log. */
export const CLIENT_LOGGABLE_EVENTS: ReadonlySet<string> = new Set<ActivityEventType>([
  "sign_in",
  "sign_out",
]);

export type LogActivityInput = {
  userId?: string | null;
  type: ActivityEventType;
  summary?: string | null;
  metadata?: Record<string, unknown> | null;
};

/**
 * Append one audit event. Fail-open: any error (missing table, missing
 * service-role key, transient DB issue) is swallowed so logging never breaks
 * the user-facing action it is attached to. Pass an existing admin client to
 * reuse a connection, otherwise one is created.
 */
export async function logActivity(
  event: LogActivityInput,
  adminClient?: SupabaseClient | null
): Promise<void> {
  try {
    const admin = adminClient ?? createAdminClient();
    if (!admin) return;

    const summary =
      typeof event.summary === "string" && event.summary.trim().length > 0
        ? event.summary.trim().slice(0, 280)
        : null;

    const { error } = await admin.from("activity_events").insert({
      user_id: event.userId ?? null,
      type: event.type,
      summary,
      metadata: event.metadata ?? null,
    });
    if (error) {
      console.warn("[activity-log] insert failed", event.type, error.message);
    }
  } catch (e) {
    console.warn("[activity-log] insert threw", e);
  }
}

const RETENTION_DAYS = Number(process.env.ACTIVITY_LOG_RETENTION_DAYS ?? 30);

/**
 * Delete audit events older than the retention window (default 30 days).
 * Fail-open; called opportunistically from the background worker.
 */
export async function pruneActivityEvents(
  adminClient?: SupabaseClient | null
): Promise<void> {
  try {
    const admin = adminClient ?? createAdminClient();
    if (!admin) return;
    const days = Number.isFinite(RETENTION_DAYS) && RETENTION_DAYS > 0 ? RETENTION_DAYS : 30;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    await admin.from("activity_events").delete().lt("created_at", cutoff);
  } catch (e) {
    console.warn("[activity-log] prune threw", e);
  }
}
