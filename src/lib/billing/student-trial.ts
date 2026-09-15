import type { PaidPlanTier } from "./plans.ts";

/**
 * Limited-time 3-day free trial on Student checkout only.
 *
 * Checkout MUST call this server-side. Never trust a client-supplied
 * `trial_days` (or similar) on the request body.
 *
 * Display code may use `NEXT_PUBLIC_STUDENT_TRIAL_ENABLED` so cards match
 * what Stripe actually starts when both flags are set.
 */

export const STUDENT_TRIAL_TIER = "student" as const satisfies PaidPlanTier;
export const STUDENT_TRIAL_DAYS = 3;

function envFlag(raw: string | undefined): boolean | null {
  const v = raw?.trim().toLowerCase();
  if (!v) return null;
  if (v === "0" || v === "false" || v === "off" || v === "no") return false;
  if (v === "1" || v === "true" || v === "on" || v === "yes") return true;
  return null;
}

/**
 * Server-authoritative Student trial switch. Default on (same pattern as
 * the subscription promo flag) unless explicitly turned off.
 */
export function isStudentTrialActive(): boolean {
  const server = envFlag(process.env.STUDENT_TRIAL_ENABLED);
  if (server != null) return server;

  const pub = envFlag(process.env.NEXT_PUBLIC_STUDENT_TRIAL_ENABLED);
  if (pub != null) return pub;

  return true;
}

/**
 * Days to pass to Stripe `subscription_data.trial_period_days`, or null
 * when this checkout must not start a trial.
 */
export function studentTrialDaysForCheckout(tier: PaidPlanTier): number | null {
  if (tier !== STUDENT_TRIAL_TIER) return null;
  if (!isStudentTrialActive()) return null;
  return STUDENT_TRIAL_DAYS;
}
