import { PLANS, type PlanTier } from "./plans.ts";

export const PAID_PLAN_TIERS = ["student", "advanced", "premium"] as const;
export type PaidPlanTier = (typeof PAID_PLAN_TIERS)[number];

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

export function isPaidPlanTier(tier: string): tier is PaidPlanTier {
  return (PAID_PLAN_TIERS as readonly string[]).includes(tier.toLowerCase());
}

export function listPriceCentsForTier(tier: PaidPlanTier): number {
  const monthly = PLANS[tier as PlanTier]?.priceMonthly ?? 0;
  return Math.round(monthly * 100);
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
