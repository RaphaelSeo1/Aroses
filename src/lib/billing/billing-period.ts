import type { PlanTier } from "@/lib/billing/plans";

export type BillingPeriod = {
  start: Date;
  startIso: string;
  endIso: string | null;
};

/**
 * Billing-period anchor for usage meters.
 * Paid users reset on Stripe `current_period_start`.
 * Internal free/unsubscribed users fall back to the 1st of the UTC month.
 */
export function resolveBillingPeriod(sub: {
  tier: PlanTier;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  now?: Date;
}): BillingPeriod {
  if (sub.tier !== "free" && sub.currentPeriodStart) {
    const start = new Date(sub.currentPeriodStart);
    if (!Number.isNaN(start.getTime())) {
      return {
        start,
        startIso: start.toISOString(),
        endIso: sub.currentPeriodEnd,
      };
    }
  }
  const now = sub.now ?? new Date();
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0)
  );
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0)
  );
  return { start, startIso: start.toISOString(), endIso: end.toISOString() };
}
