import { PAID_PLAN_TIERS, isPaidPlanTier, type PaidPlanTier } from "./plans.ts";
import { salePriceMonthly } from "./sale.ts";

export { PAID_PLAN_TIERS, isPaidPlanTier };
export type { PaidPlanTier };

export type AdminPlanSubscriptionRow = {
  userId: string;
  email: string | null;
  displayName: string | null;
  subscriberLabel: string;
  tier: PaidPlanTier;
  amountCents: number;
  currency: "usd";
  status: string;
  startedAt: string | null;
  periodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  adminGranted: boolean;
};

/**
 * Monthly cents for admin table/MRR.
 * Prefers a stored Stripe charge when present; otherwise the currently
 * charged sale/promo price (`salePriceMonthly`).
 */
export function listPriceCentsForTier(
  tier: PaidPlanTier,
  stripeAmountCents?: number | null
): number {
  if (
    typeof stripeAmountCents === "number" &&
    Number.isFinite(stripeAmountCents) &&
    stripeAmountCents >= 0
  ) {
    return Math.round(stripeAmountCents);
  }
  return Math.round(salePriceMonthly(tier) * 100);
}

/** Read a stored Stripe charge from a subscription snapshot, if the column exists. */
export function storedStripeAmountCents(row: {
  amount_cents?: number | null;
  stripe_amount_cents?: number | null;
}): number | null {
  const n = row.amount_cents ?? row.stripe_amount_cents;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

export function subscriberLabelFromParts(parts: {
  email?: string | null;
  displayName?: string | null;
  username?: string | null;
}): string {
  const email = parts.email?.trim();
  if (email) return email;
  const name = parts.displayName?.trim();
  if (name) return name;
  const username = parts.username?.trim();
  if (username) return `@${username}`;
  return "—";
}

export function startedAtFromSubscription(row: {
  currentPeriodStart: string | null;
  updatedAt: string | null;
}): string | null {
  return row.currentPeriodStart ?? row.updatedAt;
}

export function sortAdminPlanSubscriptionRows(
  rows: AdminPlanSubscriptionRow[]
): AdminPlanSubscriptionRow[] {
  return [...rows].sort((a, b) => {
    const at = a.startedAt ? new Date(a.startedAt).getTime() : 0;
    const bt = b.startedAt ? new Date(b.startedAt).getTime() : 0;
    return bt - at;
  });
}

const CURRENT_PLAN_STATUSES = new Set(["active", "trialing"]);

export type AdminPlanSubscriptionSummary = {
  subscriberCount: number;
  payingCount: number;
  mrrCents: number;
  currency: "usd";
};

/** Current subscribers + charged-price MRR (excludes admin-granted comps). */
export function summarizeAdminPlanSubscriptions(
  rows: AdminPlanSubscriptionRow[]
): AdminPlanSubscriptionSummary {
  const current = rows.filter((row) => CURRENT_PLAN_STATUSES.has(row.status));
  const paying = current.filter((row) => !row.adminGranted);
  return {
    subscriberCount: current.length,
    payingCount: paying.length,
    mrrCents: paying.reduce((sum, row) => sum + row.amountCents, 0),
    currency: "usd",
  };
}
