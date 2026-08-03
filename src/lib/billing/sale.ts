import type { PlanTier } from "@/lib/billing/plans";
import { PLANS } from "@/lib/billing/plans";

/**
 * Cosmetic subscription sale display.
 * Charged price stays `PLANS[tier].priceMonthly`.
 * UI shows a strikethrough “compare-at” list price so it looks like X% off.
 *
 * Plans may set `compareAtMonthly` for a fixed was→now display
 * (e.g. Advanced ~~$65~~ $5). Otherwise a percent-based inflate is used
 * when the sale flag is on.
 */
export function subscriptionSalePercent(): number {
  const raw = process.env.NEXT_PUBLIC_SUBSCRIPTION_SALE_PERCENT?.trim()
    || process.env.SUBSCRIPTION_SALE_PERCENT?.trim();
  const n = raw ? Number(raw) : 30;
  if (!Number.isFinite(n) || n <= 0 || n >= 100) return 30;
  return Math.round(n);
}

export function isSubscriptionSaleActive(): boolean {
  const flag = process.env.NEXT_PUBLIC_SUBSCRIPTION_SALE_ENABLED?.trim().toLowerCase();
  if (flag === "0" || flag === "false" || flag === "off") return false;
  return true;
}

/** Actual monthly price charged (same as plans). */
export function salePriceMonthly(tier: PlanTier): number {
  return PLANS[tier].priceMonthly;
}

/**
 * “Was” price for display, or null when no strikethrough should show.
 */
export function compareAtPriceMonthly(tier: PlanTier): number | null {
  const sale = PLANS[tier].priceMonthly;
  if (sale <= 0) return null;

  const fixed = PLANS[tier].compareAtMonthly;
  if (typeof fixed === "number" && fixed > sale) {
    return Math.round(fixed);
  }

  if (!isSubscriptionSaleActive()) return null;

  const pct = subscriptionSalePercent();
  return Math.max(sale + 1, Math.round(sale / (1 - pct / 100)));
}

/** Percent off shown on the pricing badge for a tier. */
export function salePercentForTier(tier: PlanTier): number {
  const sale = salePriceMonthly(tier);
  const was = compareAtPriceMonthly(tier);
  if (was == null || was <= sale || sale <= 0) return subscriptionSalePercent();
  return Math.max(1, Math.round((1 - sale / was) * 100));
}
