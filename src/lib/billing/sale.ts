import {
  isPaidPlanTier,
  PLANS,
  type PaidPlanTier,
  type PlanTier,
} from "./plans.ts";

/**
 * Subscription promotion helper.
 *
 * Charged Stripe Price IDs are chosen SERVER-SIDE from this module.
 * The client may display promo vs regular prices but must never submit a
 * Price ID or dollar amount for checkout.
 *
 * Promo ON → recurring promo Price IDs.
 * Promo OFF → recurring regular Price IDs.
 * There is no first-month-only schedule in this implementation.
 */

function envFlag(raw: string | undefined): boolean | null {
  const v = raw?.trim().toLowerCase();
  if (!v) return null;
  if (v === "0" || v === "false" || v === "off" || v === "no") return false;
  if (v === "1" || v === "true" || v === "on" || v === "yes") return true;
  return null;
}

/**
 * Server-authoritative promo switch. Checkout MUST call this (not a
 * client-only public flag) when choosing a Stripe Price ID.
 *
 * Display code on the client may use `NEXT_PUBLIC_SUBSCRIPTION_PROMO_ENABLED`
 * (or the legacy sale flag) so cards match checkout when both are set.
 */
export function isSubscriptionPromoActive(): boolean {
  const server = envFlag(process.env.SUBSCRIPTION_PROMO_ENABLED);
  if (server != null) return server;

  const pub = envFlag(
    process.env.NEXT_PUBLIC_SUBSCRIPTION_PROMO_ENABLED ??
      process.env.NEXT_PUBLIC_SUBSCRIPTION_SALE_ENABLED
  );
  if (pub != null) return pub;

  // Default on so a listed promo price is actually charged unless explicitly
  // turned off. Operators set SUBSCRIPTION_PROMO_ENABLED=false to charge
  // regular prices.
  return true;
}

/** @deprecated Use isSubscriptionPromoActive. */
export function isSubscriptionSaleActive(): boolean {
  return isSubscriptionPromoActive();
}

/** Regular (compare-at) monthly USD. */
export function regularPriceMonthly(tier: PlanTier): number {
  return PLANS[tier].priceMonthly;
}

/** Promotional monthly USD, or null when this tier has no promo. */
export function promoPriceMonthly(tier: PlanTier): number | null {
  const promo = PLANS[tier].promoPriceMonthly;
  return typeof promo === "number" && promo >= 0 ? promo : null;
}

/** Price the UI should present as the current charged amount. */
export function salePriceMonthly(tier: PlanTier): number {
  if (isSubscriptionPromoActive()) {
    const promo = promoPriceMonthly(tier);
    if (promo != null) return promo;
  }
  return regularPriceMonthly(tier);
}

/**
 * “Was” price for strikethrough, or null when no strikethrough should show.
 */
export function compareAtPriceMonthly(tier: PlanTier): number | null {
  const charged = salePriceMonthly(tier);
  if (charged <= 0) return null;
  if (!isSubscriptionPromoActive()) return null;
  const regular = regularPriceMonthly(tier);
  if (regular > charged) return regular;
  return null;
}

/** Percent off shown on the pricing badge for a tier. */
export function salePercentForTier(tier: PlanTier): number {
  const sale = salePriceMonthly(tier);
  const was = compareAtPriceMonthly(tier);
  if (was == null || was <= sale || sale <= 0) return 0;
  return Math.max(1, Math.round((1 - sale / was) * 100));
}

/** @deprecated Cosmetic percent inflate is no longer used. */
export function subscriptionSalePercent(): number {
  const sale = salePriceMonthly("advanced");
  const was = compareAtPriceMonthly("advanced");
  if (was == null || was <= sale || sale <= 0) return 0;
  return Math.max(1, Math.round((1 - sale / was) * 100));
}

export function resolveCheckoutPriceId(
  plan: { stripePriceId: string | null; stripePromoPriceId: string | null },
  promoActive: boolean
): string | null {
  if (promoActive) return plan.stripePromoPriceId ?? plan.stripePriceId;
  return plan.stripePriceId;
}

/**
 * Stripe Price ID the SERVER must charge for this paid tier.
 * Never accept a client-supplied price ID.
 */
export function checkoutStripePriceId(tier: PaidPlanTier): string | null {
  return resolveCheckoutPriceId(PLANS[tier], isSubscriptionPromoActive());
}

const PROMO_PRICE_ENV: Record<PaidPlanTier, string> = {
  student: "STRIPE_PRICE_STUDENT_PROMO",
  advanced: "STRIPE_PRICE_ADVANCED_PROMO",
  premium: "STRIPE_PRICE_PREMIUM_PROMO",
};

const REGULAR_PRICE_ENV: Record<PaidPlanTier, string> = {
  student: "STRIPE_PRICE_STUDENT_REGULAR",
  advanced: "STRIPE_PRICE_ADVANCED_REGULAR",
  premium: "STRIPE_PRICE_PREMIUM_REGULAR",
};

/** Env var Checkout expects for this tier on the current promo switch. */
export function checkoutPriceEnvName(tier: PaidPlanTier): string {
  return isSubscriptionPromoActive()
    ? PROMO_PRICE_ENV[tier]
    : REGULAR_PRICE_ENV[tier];
}

export function assertCheckoutTier(raw: unknown): PaidPlanTier | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().toLowerCase();
  return isPaidPlanTier(t) ? t : null;
}
