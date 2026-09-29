import {
  checkoutPriceEnvName as planCheckoutPriceEnvName,
  isPaidPlanTier,
  PLANS,
  type PaidPlanTier,
  type PlanTier,
} from "./plans.ts";

/**
 * Checkout pricing helpers.
 *
 * Charged Stripe Price IDs are chosen SERVER-SIDE from `plans.ts`. The client
 * may display prices but must never submit a Price ID or dollar amount.
 *
 * The five tiers are real monthly prices: there is no promo price and no
 * strike-through "regular" price. The helpers below keep their names so the
 * pricing cards can show a sale again later without touching every caller.
 */

/** Price the UI presents as the monthly charge. */
export function salePriceMonthly(tier: PlanTier): number {
  return PLANS[tier].priceMonthly;
}

/** "Was" price for a strike-through; null while no sale is running. */
export function compareAtPriceMonthly(_tier: PlanTier): number | null {
  return null;
}

/** Percent off shown on the pricing badge for a tier. */
export function salePercentForTier(tier: PlanTier): number {
  const sale = salePriceMonthly(tier);
  const was = compareAtPriceMonthly(tier);
  if (was == null || was <= sale || sale <= 0) return 0;
  return Math.max(1, Math.round((1 - sale / was) * 100));
}

/**
 * Stripe Price ID the SERVER must charge for this paid tier.
 * Never accept a client-supplied price ID.
 */
export function checkoutStripePriceId(tier: PaidPlanTier): string | null {
  return PLANS[tier].stripePriceId;
}

/** Env var that overrides the checkout price for this tier. */
export function checkoutPriceEnvName(tier: PaidPlanTier): string {
  return planCheckoutPriceEnvName(tier);
}

export function assertCheckoutTier(raw: unknown): PaidPlanTier | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().toLowerCase();
  return isPaidPlanTier(t) ? t : null;
}
