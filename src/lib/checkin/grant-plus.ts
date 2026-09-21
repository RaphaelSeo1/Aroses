import "server-only";
import { logActivity } from "@/lib/activity-log";
import { plusGrantSkipReason } from "@/lib/checkin/plus-grant";
import { PLUS_GRANT_DAYS, type PlusGrantOutcome } from "@/lib/checkin/types";
import { getUserSubscription } from "@/lib/billing/subscription";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Grant one month of Student as an admin-style comp (`admin_granted`,
 * `grant_source = checkin`). Skips Student/Advanced/Premium so we never
 * downgrade or wipe a higher Stripe plan. Keeps stripe_customer_id;
 * clears stripe_subscription_id so webhooks do not immediately revert
 * (same as a manual admin grant).
 */
export async function grantCheckInPlusMonth(
  userId: string
): Promise<PlusGrantOutcome> {
  const admin = createAdminClient();
  if (!admin) return { applied: false, reason: "write_failed" };

  const sub = await getUserSubscription(userId);
  const skip = plusGrantSkipReason({
    tier: sub.tier,
    status: sub.status,
    adminGranted: sub.adminGranted,
    grantSource: sub.grantSource,
    currentPeriodEnd: sub.currentPeriodEnd,
  });
  if (skip) return { applied: false, reason: skip };

  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setUTCDate(periodEnd.getUTCDate() + PLUS_GRANT_DAYS);
  const periodEndIso = periodEnd.toISOString();

  const payload = {
    user_id: userId,
    tier: "student" as const,
    status: "active",
    stripe_customer_id: sub.stripeCustomerId,
    stripe_subscription_id: null,
    current_period_start: now.toISOString(),
    current_period_end: periodEndIso,
    cancel_at_period_end: true,
  };

  let { error } = await admin.from("user_subscriptions").upsert(
    { ...payload, admin_granted: true, grant_source: "checkin" },
    { onConflict: "user_id" }
  );
  if (error && /grant_source|schema cache/i.test(error.message ?? "")) {
    ({ error } = await admin.from("user_subscriptions").upsert(
      { ...payload, admin_granted: true },
      { onConflict: "user_id" }
    ));
  }
  if (error && /admin_granted|schema cache/i.test(error.message ?? "")) {
    ({ error } = await admin
      .from("user_subscriptions")
      .upsert(payload, { onConflict: "user_id" }));
  }
  if (error) {
    console.error("[checkin] plus grant failed", error);
    return { applied: false, reason: "write_failed" };
  }

  await logActivity({
    userId,
    type: "checkin_plus_granted",
    summary: "30-day check-in streak granted one month of Plus",
    metadata: {
      periodEnd: periodEndIso,
      previousTier: sub.tier,
    },
  });

  return { applied: true, periodEnd: periodEndIso };
}
