/**
 * Subscription plans — THE single source of truth for tiers, prices, Stripe
 * price IDs and every monthly allowance (course pages, live lecture minutes,
 * voice tutor minutes, chat messages, extra-question clicks, daily course
 * build spend).
 *
 * Five paid tiers: Lite, Student, Plus, Pro, Max, priced from measured AI
 * cost. Internal `free` is the unsubscribed fallback (canceled / missing /
 * unpaid). It is never offered at checkout and has no expensive AI
 * allowances (chat keeps a small taste).
 *
 * Older subscribers keep their Stripe price and read as a new tier:
 * Student → Student, Advanced → Plus, Premium → Pro (see
 * LEGACY_TIER_ALIASES and LEGACY_STRIPE_PRICE_TIERS).
 *
 * Every numeric limit can be overridden per tier from the environment:
 *   PLAN_LIMIT_<TIER>_PAGES            course pages per billing period
 *   PLAN_LIMIT_<TIER>_LECTURE_MINUTES  live lecture minutes per billing period
 *   PLAN_LIMIT_<TIER>_VOICE_MINUTES    voice tutor minutes per billing period
 *   PLAN_LIMIT_<TIER>_EXTRA_QUESTIONS  extra-question clicks per billing period
 *   PLAN_LIMIT_<TIER>_DAILY_BUILD_USD  rolling 24h course-build AI spend
 *   CHAT_LIMIT_<TIER>_MESSAGES / _SONNET  (see chat-limits.ts)
 *   EXTRA_QUESTIONS_DAILY_CAP          extra-question clicks per UTC day (all tiers)
 * e.g. PLAN_LIMIT_STUDENT_PAGES=700. Overrides only apply on the server;
 * pricing cards show the defaults below.
 *
 * Numeric limits are NOT additive across tiers.
 *
 * To show/hide checkout and the billing page site-wide, see
 * `feature-flag.ts` (`BILLING_UI_ENABLED`).
 */

export type PlanTier = "free" | "lite" | "student" | "plus" | "pro" | "max";

export const PAID_PLAN_TIERS = ["lite", "student", "plus", "pro", "max"] as const;

export type PaidPlanTier = (typeof PAID_PLAN_TIERS)[number];

export type PlanLimits = {
  /** Pages of course material the course builder reads per billing period. */
  sourcePages: number;
  /** Recorded live lecture minutes per billing period. */
  lectureMinutes: number;
  /** Voice tutor minutes per billing period. */
  voiceMinutes: number;
  /** Rose chat messages per billing period. */
  chatMessages: number;
  /** Of those, how many run on the premium (Sonnet) model. */
  chatPremiumMessages: number;
  /** "Generate more questions" + "focus questions" clicks per billing period. */
  extraQuestionClicks: number;
  /** Rolling 24-hour AI spend ceiling for course builds, in USD. */
  dailyCourseBuildUsd: number;
  /**
   * AI course builds per billing period. `null` = not counted (pages are the
   * limit on every paid tier).
   */
  courseGenerations: number | null;
  /** Cumulative active PDFs allowed on one course. */
  maxPdfsPerCourse: number;
};

export type PlanConfig = {
  tier: PlanTier;
  name: string;
  /** Monthly USD charged. Stripe is the charge source of truth. */
  priceMonthly: number;
  /** Recurring Stripe Price ID used for new checkouts. Null for free. */
  stripePriceId: string | null;
  /**
   * Older Price IDs that still map to this tier (existing subscribers keep
   * paying them). Never used for new checkout.
   */
  legacyStripePriceIds: string[];
  limits: PlanLimits;
  earlyAccess: boolean;
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

/**
 * Live-mode monthly prices created for the five tiers. Price IDs are not
 * secrets; `STRIPE_PRICE_<TIER>_MONTHLY` overrides them (required in Stripe
 * test mode, where these IDs don't exist).
 */
const DEFAULT_LIVE_PRICE_IDS: Record<PaidPlanTier, string> = {
  lite: "price_1UKuPlLYnLcQuKlVAk8EjEbQ",
  student: "price_1UKuPmLYnLcQuKlV5MDooEhz",
  plus: "price_1UKuPmLYnLcQuKlVL2nCc96M",
  pro: "price_1UKuPnLYnLcQuKlVy40pqbMh",
  max: "price_1UKuPoLYnLcQuKlV8syiPcmk",
};

/**
 * Live Price IDs from the previous plan lineups. Subscribers on them keep
 * paying the same amount and get the mapped tier's allowances.
 */
const LEGACY_STRIPE_PRICE_TIERS: Record<string, PaidPlanTier> = {
  price_1Tdu1ILYnLcQuKlVA8TIie5B: "student", // Student $29
  price_1UFpv0LYnLcQuKlVDQS1XA25: "student", // Student $14.99
  price_1U38d2LYnLcQuKlVXTwztiY1: "plus", // Advanced $5
  price_1UIAdNLYnLcQuKlVsKmlSVeF: "plus", // Advanced $39.99
  price_1Tdu2CLYnLcQuKlVT4mqde0C: "pro", // Premium $59
  price_1UFpwvLYnLcQuKlVNTKjOC7V: "pro", // Premium $59.99
  price_1UFpxJLYnLcQuKlV7nOXYtYO: "plus", // retired Plus $24.99
  price_1UFptiLYnLcQuKlVAntBPDIZ: "lite", // retired Basic $3.99
};

/** Old env names whose prices still map to a tier. */
const LEGACY_PRICE_ENV: Record<PaidPlanTier, string[]> = {
  lite: ["STRIPE_PRICE_BASIC", "STRIPE_PRICE_BASIC_PROMO"],
  student: [
    "STRIPE_PRICE_STUDENT",
    "STRIPE_PRICE_STUDENT_REGULAR",
    "STRIPE_PRICE_STUDENT_PROMO",
  ],
  plus: [
    "STRIPE_PRICE_ADVANCED",
    "STRIPE_PRICE_ADVANCED_REGULAR",
    "STRIPE_PRICE_ADVANCED_PROMO",
    "STRIPE_PRICE_PLUS",
    "STRIPE_PRICE_PLUS_PROMO",
  ],
  pro: [
    "STRIPE_PRICE_PREMIUM",
    "STRIPE_PRICE_PREMIUM_REGULAR",
    "STRIPE_PRICE_PREMIUM_PROMO",
  ],
  max: [],
};

export function checkoutPriceEnvName(tier: PaidPlanTier): string {
  return `STRIPE_PRICE_${tier.toUpperCase()}_MONTHLY`;
}

function paidPlanPrices(tier: PaidPlanTier): Pick<
  PlanConfig,
  "stripePriceId" | "legacyStripePriceIds"
> {
  const current = envId(checkoutPriceEnvName(tier)) ?? DEFAULT_LIVE_PRICE_IDS[tier];
  const legacy = uniqueIds(
    ...LEGACY_PRICE_ENV[tier].map(envId),
    ...Object.entries(LEGACY_STRIPE_PRICE_TIERS)
      .filter(([, t]) => t === tier)
      .map(([id]) => id)
  ).filter((id) => id !== current);
  return { stripePriceId: current, legacyStripePriceIds: legacy };
}

export const PLANS: Record<PlanTier, PlanConfig> = {
  free: {
    tier: "free",
    name: "Free",
    priceMonthly: 0,
    stripePriceId: null,
    legacyStripePriceIds: [],
    limits: {
      sourcePages: 0,
      lectureMinutes: 0,
      voiceMinutes: 0,
      chatMessages: 20,
      chatPremiumMessages: 10,
      extraQuestionClicks: 0,
      dailyCourseBuildUsd: 0,
      courseGenerations: 0,
      maxPdfsPerCourse: 0,
    },
    earlyAccess: false,
  },
  lite: {
    tier: "lite",
    name: "Lite",
    priceMonthly: 8.99,
    ...paidPlanPrices("lite"),
    limits: {
      sourcePages: 300,
      lectureMinutes: 2 * 60,
      voiceMinutes: 10,
      chatMessages: 100,
      chatPremiumMessages: 50,
      extraQuestionClicks: 50,
      dailyCourseBuildUsd: 1,
      courseGenerations: null,
      maxPdfsPerCourse: 3,
    },
    earlyAccess: false,
  },
  student: {
    tier: "student",
    name: "Student",
    priceMonthly: 14.99,
    ...paidPlanPrices("student"),
    limits: {
      sourcePages: 600,
      lectureMinutes: 3 * 60,
      voiceMinutes: 20,
      chatMessages: 200,
      chatPremiumMessages: 50,
      extraQuestionClicks: 120,
      dailyCourseBuildUsd: 1.5,
      courseGenerations: null,
      maxPdfsPerCourse: 5,
    },
    earlyAccess: false,
  },
  plus: {
    tier: "plus",
    name: "Plus",
    priceMonthly: 29.99,
    ...paidPlanPrices("plus"),
    limits: {
      sourcePages: 1_200,
      lectureMinutes: 8 * 60,
      voiceMinutes: 45,
      chatMessages: 400,
      chatPremiumMessages: 50,
      extraQuestionClicks: 250,
      dailyCourseBuildUsd: 3,
      courseGenerations: null,
      maxPdfsPerCourse: 10,
    },
    earlyAccess: true,
  },
  pro: {
    tier: "pro",
    name: "Pro",
    priceMonthly: 49.99,
    ...paidPlanPrices("pro"),
    limits: {
      sourcePages: 2_400,
      lectureMinutes: 12 * 60,
      voiceMinutes: 90,
      chatMessages: 600,
      chatPremiumMessages: 50,
      extraQuestionClicks: 500,
      dailyCourseBuildUsd: 5,
      courseGenerations: null,
      maxPdfsPerCourse: 12,
    },
    earlyAccess: true,
  },
  max: {
    tier: "max",
    name: "Max",
    priceMonthly: 99.99,
    ...paidPlanPrices("max"),
    limits: {
      sourcePages: 5_000,
      lectureMinutes: 25 * 60,
      voiceMinutes: 150,
      chatMessages: 1_000,
      chatPremiumMessages: 50,
      extraQuestionClicks: 1_000,
      dailyCourseBuildUsd: 8,
      courseGenerations: null,
      maxPdfsPerCourse: 15,
    },
    earlyAccess: true,
  },
};

/** Internal order including the unpaid default (not shown at checkout). */
export const PLAN_ORDER: PlanTier[] = ["free", ...PAID_PLAN_TIERS];

/** Plans students can buy. Free is not offered. */
export const CHECKOUT_PLAN_ORDER: PaidPlanTier[] = [...PAID_PLAN_TIERS];

/** Highest tier: nothing to upgrade to. */
export const TOP_PLAN_TIER: PaidPlanTier = "max";

export const PLAN_RANK: Record<PlanTier, number> = {
  free: 0,
  lite: 1,
  student: 2,
  plus: 3,
  pro: 4,
  max: 5,
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

/**
 * Tier names from older lineups still stored on subscription rows. Nobody
 * silently loses paid access: Advanced reads as Plus, Premium as Pro, and the
 * retired Basic as Lite.
 */
const LEGACY_TIER_ALIASES: Record<string, PaidPlanTier> = {
  basic: "lite",
  advanced: "plus",
  premium: "pro",
};

/** Every stored `user_subscriptions.tier` value that means a paid plan. */
export const STORED_PAID_TIER_VALUES: string[] = [
  ...PAID_PLAN_TIERS,
  ...Object.keys(LEGACY_TIER_ALIASES),
];

/**
 * Tier value the database accepted before migration 118 added lite/pro/max.
 * Each reads back as the same tier through LEGACY_TIER_ALIASES, except Max,
 * which reads as Pro until the migration is applied.
 */
export function preMigrationTierValue(tier: PlanTier): string {
  if (tier === "lite") return "basic";
  if (tier === "pro" || tier === "max") return "premium";
  return tier;
}

/** Postgres rejected the tier value (user_subscriptions_tier_check). */
export function isTierCheckViolation(
  err: { code?: string; message?: string } | null | undefined
): boolean {
  if (!err) return false;
  return err.code === "23514" || /user_subscriptions_tier_check/i.test(err.message ?? "");
}

export function parsePlanTier(raw: string | null | undefined): PlanTier | null {
  const t = (raw ?? "").trim().toLowerCase();
  if ((PLAN_ORDER as readonly string[]).includes(t)) return t as PlanTier;
  return LEGACY_TIER_ALIASES[t] ?? null;
}

export function hasEarlyAccess(tier: PlanTier): boolean {
  return PLANS[tier]?.earlyAccess === true;
}

export function meetsPlanRank(tier: PlanTier, minimum: PlanTier): boolean {
  return PLAN_RANK[tier] >= PLAN_RANK[minimum];
}

type Env = Record<string, string | undefined>;

function envCount(env: Env, name: string): number | null {
  const raw = env[name]?.trim();
  if (!raw || !/^\d+$/.test(raw)) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isSafeInteger(n) ? n : null;
}

function envUsd(env: Env, name: string): number | null {
  const raw = env[name]?.trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** A tier's allowances with any `PLAN_LIMIT_<TIER>_*` overrides applied. */
export function planLimits(tier: PlanTier, env: Env = process.env): PlanLimits {
  const base = (PLANS[tier] ?? PLANS.free).limits;
  const key = `PLAN_LIMIT_${tier.toUpperCase()}`;
  return {
    ...base,
    sourcePages: envCount(env, `${key}_PAGES`) ?? base.sourcePages,
    lectureMinutes:
      envCount(env, `${key}_LECTURE_MINUTES`) ?? base.lectureMinutes,
    voiceMinutes: envCount(env, `${key}_VOICE_MINUTES`) ?? base.voiceMinutes,
    extraQuestionClicks:
      envCount(env, `${key}_EXTRA_QUESTIONS`) ?? base.extraQuestionClicks,
    dailyCourseBuildUsd:
      envUsd(env, `${key}_DAILY_BUILD_USD`) ?? base.dailyCourseBuildUsd,
  };
}

/** Monthly voice allowance for a tier, in seconds (used by server-side caps). */
export function voiceCapSeconds(tier: PlanTier, env?: Env): number {
  return Math.max(0, Math.round(planLimits(tier, env).voiceMinutes * 60));
}

/** Monthly live lecture allowance for a tier, in seconds. */
export function lectureCapSeconds(tier: PlanTier, env?: Env): number {
  return Math.max(0, Math.round(planLimits(tier, env).lectureMinutes * 60));
}

/** AI course builds per billing period; null = not counted. */
export function courseGenerationCap(tier: PlanTier): number | null {
  const n = PLANS[tier]?.limits.courseGenerations;
  return n == null ? null : Math.max(0, n);
}

export function sourcePageCap(tier: PlanTier, env?: Env): number {
  return Math.max(0, planLimits(tier, env).sourcePages);
}

export function extraQuestionCap(tier: PlanTier, env?: Env): number {
  return Math.max(0, planLimits(tier, env).extraQuestionClicks);
}

/** Extra-question clicks per UTC day on every tier (abuse guard). */
export const EXTRA_QUESTIONS_DAILY_CAP = 60;

/** Daily extra-question clicks; `EXTRA_QUESTIONS_DAILY_CAP` overrides. */
export function extraQuestionDailyCap(env: Env = process.env): number {
  return envCount(env, "EXTRA_QUESTIONS_DAILY_CAP") ?? EXTRA_QUESTIONS_DAILY_CAP;
}

export function maxPdfsPerCourse(tier: PlanTier): number {
  return Math.max(0, PLANS[tier]?.limits.maxPdfsPerCourse ?? 0);
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
  return uniqueIds(plan.stripePriceId, ...plan.legacyStripePriceIds);
}

export function stripePriceIdsForTier(tier: PlanTier): string[] {
  return priceIdsForTier(tier);
}

/**
 * Resolve a Stripe price ID back to a tier (used by the webhook). The current
 * checkout price wins over a legacy mapping if an env reuses an old ID.
 */
export function tierForPriceId(
  priceId: string | null | undefined
): PlanTier | null {
  if (!priceId) return null;
  for (const tier of PAID_PLAN_TIERS) {
    if (PLANS[tier].stripePriceId === priceId) return tier;
  }
  for (const tier of PAID_PLAN_TIERS) {
    if (PLANS[tier].legacyStripePriceIds.includes(priceId)) return tier;
  }
  return null;
}

export function previousPaidTier(tier: PaidPlanTier): PaidPlanTier | null {
  const i = CHECKOUT_PLAN_ORDER.indexOf(tier);
  if (i <= 0) return null;
  return CHECKOUT_PLAN_ORDER[i - 1] ?? null;
}

/** Next tier up, or null on the top tier. */
export function nextPaidTier(tier: PlanTier): PaidPlanTier | null {
  if (tier === "free") return CHECKOUT_PLAN_ORDER[0] ?? null;
  const i = CHECKOUT_PLAN_ORDER.indexOf(tier);
  if (i < 0 || i >= CHECKOUT_PLAN_ORDER.length - 1) return null;
  return CHECKOUT_PLAN_ORDER[i + 1] ?? null;
}
