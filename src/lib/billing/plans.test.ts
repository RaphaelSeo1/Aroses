import assert from "node:assert/strict";
import test from "node:test";
import {
  CHECKOUT_PLAN_ORDER,
  PLANS,
  TOP_PLAN_TIER,
  EXTRA_QUESTIONS_DAILY_CAP,
  courseGenerationCap,
  extraQuestionCap,
  extraQuestionDailyCap,
  hasEarlyAccess,
  isPaidTier,
  isTierCheckViolation,
  lectureCapSeconds,
  maxPdfsPerCourse,
  nextPaidTier,
  parsePlanTier,
  planLimits,
  preMigrationTierValue,
  sourcePageCap,
  tierForPriceId,
  voiceCapSeconds,
  type PaidPlanTier,
} from "./plans.ts";

const EXPECTED: Record<
  PaidPlanTier,
  {
    price: number;
    pages: number;
    lectureHours: number;
    voiceMin: number;
    chat: number;
    extra: number;
    dailyUsd: number;
    early: boolean;
  }
> = {
  lite: { price: 8.99, pages: 300, lectureHours: 2, voiceMin: 10, chat: 100, extra: 50, dailyUsd: 1, early: false },
  student: { price: 14.99, pages: 600, lectureHours: 3, voiceMin: 20, chat: 200, extra: 120, dailyUsd: 1.5, early: false },
  plus: { price: 29.99, pages: 1200, lectureHours: 8, voiceMin: 45, chat: 400, extra: 250, dailyUsd: 3, early: true },
  pro: { price: 49.99, pages: 2400, lectureHours: 12, voiceMin: 90, chat: 600, extra: 500, dailyUsd: 5, early: true },
  max: { price: 99.99, pages: 5000, lectureHours: 25, voiceMin: 150, chat: 1000, extra: 1000, dailyUsd: 8, early: true },
};

const NO_ENV = {};

test("checkout offers exactly Lite, Student, Plus, Pro, Max in order", () => {
  assert.deepEqual(CHECKOUT_PLAN_ORDER, ["lite", "student", "plus", "pro", "max"]);
  assert.equal(TOP_PLAN_TIER, "max");
});

test("each paid tier has the approved price and allowances", () => {
  for (const tier of CHECKOUT_PLAN_ORDER) {
    const e = EXPECTED[tier];
    const limits = planLimits(tier, NO_ENV);
    assert.equal(PLANS[tier].priceMonthly, e.price, tier);
    assert.equal(limits.sourcePages, e.pages, tier);
    assert.equal(limits.lectureMinutes, e.lectureHours * 60, tier);
    assert.equal(limits.voiceMinutes, e.voiceMin, tier);
    assert.equal(limits.chatMessages, e.chat, tier);
    assert.equal(limits.chatPremiumMessages, 50, tier);
    assert.equal(limits.extraQuestionClicks, e.extra, tier);
    assert.equal(limits.dailyCourseBuildUsd, e.dailyUsd, tier);
    assert.equal(sourcePageCap(tier, NO_ENV), e.pages, tier);
    assert.equal(lectureCapSeconds(tier, NO_ENV), e.lectureHours * 3600, tier);
    assert.equal(voiceCapSeconds(tier, NO_ENV), e.voiceMin * 60, tier);
    assert.equal(extraQuestionCap(tier, NO_ENV), e.extra, tier);
    assert.equal(hasEarlyAccess(tier), e.early, tier);
    // Paid tiers are limited by pages, not by a course count.
    assert.equal(courseGenerationCap(tier), null, tier);
    assert.ok(maxPdfsPerCourse(tier) > 0, tier);
    assert.ok(PLANS[tier].stripePriceId, tier);
  }
});

test("free keeps today's allowance: nothing expensive, 20 chat messages (10 on Sonnet)", () => {
  const limits = planLimits("free", NO_ENV);
  assert.equal(isPaidTier("free"), false);
  assert.equal(limits.sourcePages, 0);
  assert.equal(limits.lectureMinutes, 0);
  assert.equal(limits.voiceMinutes, 0);
  assert.equal(limits.extraQuestionClicks, 0);
  assert.equal(limits.chatMessages, 20);
  assert.equal(limits.chatPremiumMessages, 10);
  assert.equal(courseGenerationCap("free"), 0);
  assert.equal(maxPdfsPerCourse("free"), 0);
  assert.ok(!CHECKOUT_PLAN_ORDER.includes("free" as never));
});

test("PLAN_LIMIT_<TIER>_* env overrides apply per tier and ignore junk", () => {
  const env = {
    PLAN_LIMIT_STUDENT_PAGES: "700",
    PLAN_LIMIT_STUDENT_LECTURE_MINUTES: "240",
    PLAN_LIMIT_STUDENT_VOICE_MINUTES: "30",
    PLAN_LIMIT_STUDENT_EXTRA_QUESTIONS: "20",
    PLAN_LIMIT_STUDENT_DAILY_BUILD_USD: "2.5",
    PLAN_LIMIT_PRO_PAGES: "lots",
  };
  const student = planLimits("student", env);
  assert.equal(student.sourcePages, 700);
  assert.equal(student.lectureMinutes, 240);
  assert.equal(student.voiceMinutes, 30);
  assert.equal(student.extraQuestionClicks, 20);
  assert.equal(student.dailyCourseBuildUsd, 2.5);
  assert.equal(planLimits("pro", env).sourcePages, 2400);
  assert.equal(planLimits("plus", env).sourcePages, 1200);
});

test("extra questions: 60 clicks a day on every tier, overridable by env", () => {
  assert.equal(EXTRA_QUESTIONS_DAILY_CAP, 60);
  assert.equal(extraQuestionDailyCap({}), 60);
  assert.equal(extraQuestionDailyCap({ EXTRA_QUESTIONS_DAILY_CAP: "25" }), 25);
  assert.equal(extraQuestionDailyCap({ EXTRA_QUESTIONS_DAILY_CAP: "lots" }), 60);
  assert.equal(extraQuestionCap("free", {}), 0);
});

test("old tier names read as the mapped new tier", () => {
  assert.equal(parsePlanTier("basic"), "lite");
  assert.equal(parsePlanTier("student"), "student");
  assert.equal(parsePlanTier("advanced"), "plus");
  assert.equal(parsePlanTier("Premium"), "pro");
  assert.equal(parsePlanTier("max"), "max");
  assert.equal(parsePlanTier("enterprise"), null);
});

test("old live Stripe prices map onto new tiers; new prices map to their tier", () => {
  assert.equal(tierForPriceId("price_1Tdu1ILYnLcQuKlVA8TIie5B"), "student");
  assert.equal(tierForPriceId("price_1UFpv0LYnLcQuKlVDQS1XA25"), "student");
  assert.equal(tierForPriceId("price_1U38d2LYnLcQuKlVXTwztiY1"), "plus");
  assert.equal(tierForPriceId("price_1UIAdNLYnLcQuKlVsKmlSVeF"), "plus");
  assert.equal(tierForPriceId("price_1Tdu2CLYnLcQuKlVT4mqde0C"), "pro");
  assert.equal(tierForPriceId("price_1UFpwvLYnLcQuKlVNTKjOC7V"), "pro");
  assert.equal(tierForPriceId("price_1UFptiLYnLcQuKlVAntBPDIZ"), "lite");
  for (const tier of CHECKOUT_PLAN_ORDER) {
    assert.equal(tierForPriceId(PLANS[tier].stripePriceId), tier);
  }
  assert.equal(tierForPriceId("price_unknown"), null);
  assert.equal(tierForPriceId(null), null);
});

test("before migration 118, new tiers are stored under names the DB accepts", () => {
  assert.equal(preMigrationTierValue("lite"), "basic");
  assert.equal(preMigrationTierValue("student"), "student");
  assert.equal(preMigrationTierValue("plus"), "plus");
  assert.equal(preMigrationTierValue("pro"), "premium");
  assert.equal(preMigrationTierValue("max"), "premium");
  // Stand-ins read back as a paid tier, never as free.
  for (const tier of CHECKOUT_PLAN_ORDER) {
    assert.notEqual(parsePlanTier(preMigrationTierValue(tier)), "free");
    assert.notEqual(parsePlanTier(preMigrationTierValue(tier)), null);
  }
  assert.equal(isTierCheckViolation({ code: "23514" }), true);
  assert.equal(
    isTierCheckViolation({ message: 'violates check constraint "user_subscriptions_tier_check"' }),
    true
  );
  assert.equal(isTierCheckViolation({ code: "42703" }), false);
  assert.equal(isTierCheckViolation(null), false);
});

test("upgrade path climbs one tier at a time and stops at Max", () => {
  assert.equal(nextPaidTier("free"), "lite");
  assert.equal(nextPaidTier("lite"), "student");
  assert.equal(nextPaidTier("pro"), "max");
  assert.equal(nextPaidTier("max"), null);
});
