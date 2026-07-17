/**
 * Subscription plans — THE single source of truth for tiers, prices, Stripe
 * price IDs, voice allowance, and course-build caps. Tune everything here.
 *
 * To show/hide checkout and the billing page site-wide, see
 * `feature-flag.ts` (`BILLING_UI_ENABLED`).
 *
 * Voice is metered monthly on every tier. Course creation is capped on
 * Student (2 courses); Free and Premium stay unlimited. Quizzes, SRS, and
 * text tutoring stay unlimited. When voice hours run out, voice stops and
 * the user keeps free TEXT mode (never a hard block).
 *
 * Stripe price IDs come from env so test/live keys swap without code changes,
 * but the mapping + limits live ONLY in this file.
 */

export type PlanTier = "free" | "student" | "premium";

export type PlanConfig = {
  tier: PlanTier;
  name: string;
  /** Display price in USD per month (informational; Stripe is the source of charge). */
  priceMonthly: number;
  /** Stripe recurring Price ID. Null for free / when the env var is unset. */
  stripePriceId: string | null;
  /** Monthly voice-tutoring allowance, in hours. */
  voiceHours: number;
  /**
   * Max owned courses this tier may create. `null` = unlimited.
   * Enforced on course insert (not on rebuilding materials inside a course).
   */
  maxCourses: number | null;
  /** One-line tagline for the pricing card. */
  tagline: string;
  /** Bullet highlights for the pricing card. */
  highlights: string[];
};

export const PLANS: Record<PlanTier, PlanConfig> = {
  free: {
    tier: "free",
    name: "Free",
    priceMonthly: 0,
    stripePriceId: null,
    voiceHours: 0.5,
    maxCourses: null,
    tagline: "Everything to start learning, on us.",
    highlights: [
      "30 minutes of voice tutoring / month",
      "Unlimited text tutoring after that",
      "Course building, quizzes & spaced repetition",
    ],
  },
  student: {
    tier: "student",
    name: "Student",
    priceMonthly: 29,
    stripePriceId: process.env.STRIPE_PRICE_STUDENT ?? null,
    voiceHours: 5,
    maxCourses: 2,
    tagline: "For daily, voice-first studying.",
    highlights: [
      "5 hours of voice tutoring / month",
      "Build up to 2 courses",
      "Unlimited quizzes, SRS & text tutoring",
    ],
  },
  premium: {
    tier: "premium",
    name: "Premium",
    priceMonthly: 59,
    stripePriceId: process.env.STRIPE_PRICE_PREMIUM ?? null,
    voiceHours: 15,
    maxCourses: null,
    tagline: "For power users who live in voice.",
    highlights: [
      "15 hours of voice tutoring / month",
      "Unlimited course building",
      "Priority features (coming soon)",
    ],
  },
};

/** Display / iteration order, cheapest first. */
export const PLAN_ORDER: PlanTier[] = ["free", "student", "premium"];

/**
 * À-la-carte voice top-up (placeholder). The purchase flow is a follow-up; the
 * config + the `bonus_seconds` seam in voice usage are where it plugs in.
 */
export const VOICE_TOPUP = {
  stripePriceId: process.env.STRIPE_PRICE_TOPUP ?? null,
  hoursPerUnit: 1,
  priceUsd: 8,
};

/** Monthly voice allowance for a tier, in seconds (used by server-side caps). */
export function voiceCapSeconds(tier: PlanTier): number {
  return Math.round((PLANS[tier]?.voiceHours ?? 0) * 3600);
}

/** Course-creation cap for a tier (`null` = unlimited). */
export function courseCap(tier: PlanTier): number | null {
  const cap = PLANS[tier]?.maxCourses;
  return typeof cap === "number" && cap >= 0 ? cap : null;
}

/** Resolve a Stripe price ID back to a tier (used by the webhook). */
export function tierForPriceId(priceId: string | null | undefined): PlanTier | null {
  if (!priceId) return null;
  for (const tier of PLAN_ORDER) {
    if (PLANS[tier].stripePriceId && PLANS[tier].stripePriceId === priceId) {
      return tier;
    }
  }
  return null;
}

export function isPaidTier(tier: PlanTier): boolean {
  return tier !== "free";
}
