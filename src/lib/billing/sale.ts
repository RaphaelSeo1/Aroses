import type { PlanTier } from "@/lib/billing/plans";
import { PLANS } from "@/lib/billing/plans";

/**
 * Cosmetic subscription sale display.
 * Charged price stays `PLANS[tier].priceMonthly` ($29 / $59).
 * UI shows a strikethrough “compare-at” list price so it looks like X% off.
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
 * Inflated “was” price for display only.
 * e.g. $29 at 30% off → compare-at $41.
 */
export function compareAtPriceMonthly(tier: PlanTier): number {
  const sale = PLANS[tier].priceMonthly;
  if (sale <= 0) return 0;
  const pct = subscriptionSalePercent();
  return Math.max(sale + 1, Math.round(sale / (1 - pct / 100)));
}
