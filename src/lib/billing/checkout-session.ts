import type Stripe from "stripe";
import type { PaidPlanTier } from "./plans.ts";
import { studentTrialDaysForCheckout } from "./student-trial.ts";

/**
 * Stripe Checkout Session params for a paid plan upgrade.
 *
 * Price IDs and trial days are resolved SERVER-SIDE before this is called.
 * The client must never supply a Price ID.
 */
export function planCheckoutSessionParams(opts: {
  customerId: string;
  priceId: string;
  origin: string;
  userId: string;
  tier: PaidPlanTier;
}): Stripe.Checkout.SessionCreateParams {
  const trialDays = studentTrialDaysForCheckout(opts.tier);
  return {
    mode: "subscription",
    customer: opts.customerId,
    line_items: [{ price: opts.priceId, quantity: 1 }],
    success_url: `${opts.origin}/dashboard/profile?tab=billing&status=success`,
    cancel_url: `${opts.origin}/dashboard/profile?tab=billing&status=cancel`,
    allow_promotion_codes: true,
    client_reference_id: opts.userId,
    metadata: { user_id: opts.userId },
    subscription_data: {
      metadata: { user_id: opts.userId },
      ...(trialDays != null ? { trial_period_days: trialDays } : {}),
    },
  };
}
