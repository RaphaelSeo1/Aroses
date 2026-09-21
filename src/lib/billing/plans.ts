/**
 * Subscription plans — THE single source of truth for tiers, prices, Stripe
 * price IDs, voice allowance, generation caps, source pages, PDF limits,
 * lecture-recording caps, and course-generation depth.
 *
 * Internal `free` is the unsubscribed fallback (canceled / missing / unpaid).
 * It is never offered at checkout and has no expensive AI allowances.
 *
 * Numeric limits are NOT additive across tiers. Student gets 200 source pages
 * total — not Basic's 80 plus Student's 200.
 *
 * To show/hide checkout and the billing page site-wide, see
 * `feature-flag.ts` (`BILLING_UI_ENABLED`).
 */

export type PlanTier =
  | "free"
  | "basic"
  | "student"
  | "plus"
  | "advanced"
  | "premium";

export const PAID_PLAN_TIERS = [
  "basic",
  "student",
  "plus",
  "advanced",
  "premium",
] as const;

export type PaidPlanTier = (typeof PAID_PLAN_TIERS)[number];

export type CourseGenerationDepth =
  | "essential"
  | "standard"
  | "detailed"
  | "comprehensive"
  | "maximum";

export type PlanConfig = {
  tier: PlanTier;
  name: string;
  /** Regular (non-promo) monthly USD. Stripe is the charge source of truth. */
  priceMonthly: number;
  /** Promotional monthly USD charged when the promo flag is on. */
  promoPriceMonthly: number | null;
  /** Regular recurring Stripe Price ID. Null for free / when unset. */
  stripePriceId: string | null;
  /** Promo recurring Stripe Price ID. Null for free / when unset. */
  stripePromoPriceId: string | null;
  /**
   * Extra Price IDs that still map to this tier (legacy subscribers).
   * Never used for new checkout once regular/promo IDs exist.
   */
  legacyStripePriceIds: string[];
  /** Monthly voice-tutoring allowance, in minutes. */
  voiceMinutes: number;
  /** Successful AI course generations per billing period. */
  courseGenerations: number;
  /** Normalized source-page equivalents per billing period. */
  sourcePages: number;
  /** Cumulative active PDFs allowed on one course. */
  maxPdfsPerCourse: number;
  /** New live lecture recording sessions per billing period. */
  lectureRecordings: number;
  generationDepth: CourseGenerationDepth;
  earlyAccess: boolean;
  /** One-line tagline for the pricing card. */
  tagline: string;
  /** Incremental highlights (cumulative “everything in previous, plus”). */
  highlights: string[];
};

function envId(name: string): string | null {
  const v = process.env[name]?.trim();
  return v ? v : null;
}

function uniqueIds(...ids: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

const BASIC_REGULAR =
  envId("STRIPE_PRICE_BASIC_REGULAR") ?? envId("STRIPE_PRICE_BASIC");
const STUDENT_REGULAR =
  envId("STRIPE_PRICE_STUDENT_REGULAR") ?? envId("STRIPE_PRICE_STUDENT");
const PLUS_REGULAR =
  envId("STRIPE_PRICE_PLUS_REGULAR") ?? envId("STRIPE_PRICE_PLUS");
const ADVANCED_REGULAR =
  envId("STRIPE_PRICE_ADVANCED_REGULAR") ?? envId("STRIPE_PRICE_ADVANCED");
const PREMIUM_REGULAR =
  envId("STRIPE_PRICE_PREMIUM_REGULAR") ?? envId("STRIPE_PRICE_PREMIUM");

export const PLANS: Record<PlanTier, PlanConfig> = {
  free: {
    tier: "free",
    name: "Free",
    priceMonthly: 0,
    promoPriceMonthly: null,
    stripePriceId: null,
    stripePromoPriceId: null,
    legacyStripePriceIds: [],
    voiceMinutes: 0,
    courseGenerations: 0,
    sourcePages: 0,
    maxPdfsPerCourse: 0,
    lectureRecordings: 0,
    generationDepth: "essential",
    earlyAccess: false,
    tagline: "Unpaid default — not offered at checkout.",
    highlights: ["Choose a plan to generate AI courses."],
  },
  basic: {
    tier: "basic",
    name: "Basic",
    priceMonthly: 19.99,
    promoPriceMonthly: 3.99,
    stripePriceId: BASIC_REGULAR,
    stripePromoPriceId: envId("STRIPE_PRICE_BASIC_PROMO"),
    legacyStripePriceIds: uniqueIds(
      envId("STRIPE_PRICE_BASIC"),
      BASIC_REGULAR
    ).filter((id) => id !== BASIC_REGULAR),
    voiceMinutes: 30,
    courseGenerations: 1,
    sourcePages: 80,
    maxPdfsPerCourse: 3,
    lectureRecordings: 1,
    generationDepth: "essential",
    earlyAccess: false,
    tagline: "Core AI studying for lighter workloads.",
    highlights: [
      "Essential AI course generation",
      "1 AI course generation / billing period",
      "80 source pages",
      "Up to 3 PDFs per course",
      "30 minutes voice tutoring",
      "1 lecture recording",
      "Unlimited quizzes",
      "SRS / flashcards",
      "Text tutoring",
      "Notes Hub",
      "Mentored Learning on generated courses",
    ],
  },
  student: {
    tier: "student",
    name: "Student",
    priceMonthly: 39.99,
    promoPriceMonthly: 14.99,
    stripePriceId: STUDENT_REGULAR,
    stripePromoPriceId: envId("STRIPE_PRICE_STUDENT_PROMO"),
    legacyStripePriceIds: uniqueIds(
      envId("STRIPE_PRICE_STUDENT"),
      STUDENT_REGULAR
    ).filter((id) => id !== STUDENT_REGULAR),
    voiceMinutes: 90,
    courseGenerations: 2,
    sourcePages: 200,
    maxPdfsPerCourse: 5,
    lectureRecordings: 3,
    generationDepth: "standard",
    earlyAccess: false,
    tagline: "For students studying across multiple classes.",
    highlights: [
      "Standard course generation",
      "2 AI course generations",
      "200 source pages",
      "Up to 5 PDFs per course",
      "1.5 hours voice tutoring",
      "3 lecture recordings",
    ],
  },
  plus: {
    tier: "plus",
    name: "Plus",
    priceMonthly: 59.99,
    promoPriceMonthly: 24.99,
    stripePriceId: PLUS_REGULAR,
    stripePromoPriceId: envId("STRIPE_PRICE_PLUS_PROMO"),
    legacyStripePriceIds: uniqueIds(
      envId("STRIPE_PRICE_PLUS"),
      PLUS_REGULAR
    ).filter((id) => id !== PLUS_REGULAR),
    voiceMinutes: 150,
    courseGenerations: 3,
    sourcePages: 300,
    maxPdfsPerCourse: 8,
    lectureRecordings: 5,
    generationDepth: "detailed",
    earlyAccess: false,
    tagline: "More courses, voice, and deeper explanations.",
    highlights: [
      "Detailed course generation",
      "3 AI course generations",
      "300 source pages",
      "Up to 8 PDFs per course",
      "2.5 hours voice tutoring",
      "5 lecture recordings",
    ],
  },
  advanced: {
    tier: "advanced",
    name: "Advanced",
    priceMonthly: 79.99,
    promoPriceMonthly: 29.99,
    stripePriceId: ADVANCED_REGULAR,
    stripePromoPriceId: envId("STRIPE_PRICE_ADVANCED_PROMO"),
    legacyStripePriceIds: uniqueIds(
      envId("STRIPE_PRICE_ADVANCED"),
      ADVANCED_REGULAR
    ).filter((id) => id !== ADVANCED_REGULAR),
    voiceMinutes: 180,
    courseGenerations: 3,
    sourcePages: 400,
    maxPdfsPerCourse: 10,
    lectureRecordings: 6,
    generationDepth: "comprehensive",
    earlyAccess: true,
    tagline: "Comprehensive depth, higher limits, and early access.",
    highlights: [
      "Comprehensive course generation",
      "3 AI course generations",
      "400 source pages",
      "Up to 10 PDFs per course",
      "3 hours voice tutoring",
      "6 lecture recordings",
      "Early access to new features",
    ],
  },
  premium: {
    tier: "premium",
    name: "Premium",
    priceMonthly: 109.99,
    promoPriceMonthly: 59.99,
    stripePriceId: PREMIUM_REGULAR,
    stripePromoPriceId: envId("STRIPE_PRICE_PREMIUM_PROMO"),
    legacyStripePriceIds: uniqueIds(
      envId("STRIPE_PRICE_PREMIUM"),
      PREMIUM_REGULAR
    ).filter((id) => id !== PREMIUM_REGULAR),
    voiceMinutes: 240,
    courseGenerations: 4,
    sourcePages: 500,
    maxPdfsPerCourse: 12,
    lectureRecordings: 8,
    generationDepth: "maximum",
    earlyAccess: true,
    tagline: "Maximum depth and the highest Aroses limits.",
    highlights: [
      "Maximum course generation",
      "4 AI course generations",
      "500 source pages",
      "Up to 12 PDFs per course",
      "4 hours voice tutoring",
      "8 lecture recordings",
    ],
  },
};

/** Internal order including the unpaid default (not shown at checkout). */
export const PLAN_ORDER: PlanTier[] = [
  "free",
  "basic",
  "student",
  "plus",
  "advanced",
  "premium",
];

/** Plans students can buy. Free is not offered. */
export const CHECKOUT_PLAN_ORDER: PaidPlanTier[] = [
  "basic",
  "student",
  "plus",
  "advanced",
  "premium",
];

export const PLAN_RANK: Record<PlanTier, number> = {
  free: 0,
  basic: 1,
  student: 2,
  plus: 3,
  advanced: 4,
  premium: 5,
};

/**
 * À-la-carte voice top-up (placeholder). The purchase flow is a follow-up; the
 * config + the `bonus_seconds` seam in voice usage are where it plugs in.
 */
export const VOICE_TOPUP = {
  stripePriceId: envId("STRIPE_PRICE_TOPUP"),
  hoursPerUnit: 1,
  priceUsd: 8,
};

export function isPaidTier(tier: PlanTier): boolean {
  return tier !== "free";
}

export function isPaidPlanTier(tier: string): tier is PaidPlanTier {
  return (PAID_PLAN_TIERS as readonly string[]).includes(tier.toLowerCase());
}

export function parsePlanTier(raw: string | null | undefined): PlanTier | null {
  const t = (raw ?? "").trim().toLowerCase();
  if ((PLAN_ORDER as readonly string[]).includes(t)) return t as PlanTier;
  return null;
}

export function hasEarlyAccess(tier: PlanTier): boolean {
  return PLANS[tier]?.earlyAccess === true;
}

export function meetsPlanRank(tier: PlanTier, minimum: PlanTier): boolean {
  return PLAN_RANK[tier] >= PLAN_RANK[minimum];
}

/** Monthly voice allowance for a tier, in seconds (used by server-side caps). */
export function voiceCapSeconds(tier: PlanTier): number {
  return Math.max(0, Math.round((PLANS[tier]?.voiceMinutes ?? 0) * 60));
}

/** Voice hours for display (derived from minutes). */
export function voiceHours(tier: PlanTier): number {
  return (PLANS[tier]?.voiceMinutes ?? 0) / 60;
}

/** Successful AI course generations per billing period. */
export function courseGenerationCap(tier: PlanTier): number {
  return Math.max(0, PLANS[tier]?.courseGenerations ?? 0);
}

/** @deprecated Use `courseGenerationCap`. Kept for older call sites. */
export function courseCap(tier: PlanTier): number {
  return courseGenerationCap(tier);
}

export function sourcePageCap(tier: PlanTier): number {
  return Math.max(0, PLANS[tier]?.sourcePages ?? 0);
}

export function maxPdfsPerCourse(tier: PlanTier): number {
  return Math.max(0, PLANS[tier]?.maxPdfsPerCourse ?? 0);
}

export function lectureRecordingCap(tier: PlanTier): number {
  return Math.max(0, PLANS[tier]?.lectureRecordings ?? 0);
}

export function generationDepthForTier(tier: PlanTier): CourseGenerationDepth {
  return PLANS[tier]?.generationDepth ?? "essential";
}

export function formatUsdAmount(amount: number): string {
  if (!Number.isFinite(amount)) return "0.00";
  return amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function priceIdsForTier(tier: PlanTier): string[] {
  const plan = PLANS[tier];
  return uniqueIds(
    plan.stripePriceId,
    plan.stripePromoPriceId,
    ...plan.legacyStripePriceIds
  );
}

export function stripePriceIdsForTier(tier: PlanTier): string[] {
  return priceIdsForTier(tier);
}

/** Resolve a Stripe price ID back to a tier (used by the webhook). */
export function tierForPriceId(
  priceId: string | null | undefined
): PlanTier | null {
  if (!priceId) return null;
  for (const tier of PLAN_ORDER) {
    if (priceIdsForTier(tier).includes(priceId)) return tier;
  }
  return null;
}

export function previousPaidTier(tier: PaidPlanTier): PaidPlanTier | null {
  const i = CHECKOUT_PLAN_ORDER.indexOf(tier);
  if (i <= 0) return null;
  return CHECKOUT_PLAN_ORDER[i - 1] ?? null;
}
