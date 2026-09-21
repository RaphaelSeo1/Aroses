import assert from "node:assert/strict";
import test from "node:test";
import {
  CHECKOUT_PLAN_ORDER,
  PLANS,
  courseGenerationCap,
  hasEarlyAccess,
  isPaidTier,
  lectureRecordingCap,
  maxPdfsPerCourse,
  sourcePageCap,
  voiceCapSeconds,
  type PlanTier,
} from "./plans.ts";

test("public paid tiers have the specified entitlements", () => {
  const expected: Record<
    Exclude<PlanTier, "free">,
    {
      gens: number;
      pages: number;
      pdfs: number;
      voiceMin: number;
      recordings: number;
      early: boolean;
      regular: number;
      promo: number;
    }
  > = {
    student: {
      gens: 2,
      pages: 200,
      pdfs: 5,
      voiceMin: 90,
      recordings: 3,
      early: false,
      regular: 39.99,
      promo: 14.99,
    },
    advanced: {
      gens: 3,
      pages: 400,
      pdfs: 10,
      voiceMin: 180,
      recordings: 6,
      early: true,
      regular: 79.99,
      promo: 39.99,
    },
    premium: {
      gens: 4,
      pages: 500,
      pdfs: 12,
      voiceMin: 240,
      recordings: 8,
      early: true,
      regular: 109.99,
      promo: 59.99,
    },
  };

  for (const tier of CHECKOUT_PLAN_ORDER) {
    const e = expected[tier];
    assert.equal(courseGenerationCap(tier), e.gens, tier);
    assert.equal(sourcePageCap(tier), e.pages, tier);
    assert.equal(maxPdfsPerCourse(tier), e.pdfs, tier);
    assert.equal(voiceCapSeconds(tier), e.voiceMin * 60, tier);
    assert.equal(lectureRecordingCap(tier), e.recordings, tier);
    assert.equal(hasEarlyAccess(tier), e.early, tier);
    assert.equal(PLANS[tier].priceMonthly, e.regular, tier);
    assert.equal(PLANS[tier].promoPriceMonthly, e.promo, tier);
  }
});

test("internal free has zero expensive allowances and is not at checkout", () => {
  assert.equal(isPaidTier("free"), false);
  assert.equal(courseGenerationCap("free"), 0);
  assert.equal(sourcePageCap("free"), 0);
  assert.equal(maxPdfsPerCourse("free"), 0);
  assert.equal(voiceCapSeconds("free"), 0);
  assert.equal(lectureRecordingCap("free"), 0);
  assert.equal(hasEarlyAccess("free"), false);
  assert.ok(!CHECKOUT_PLAN_ORDER.includes("free" as never));
});

test("numeric limits are not additive across tiers", () => {
  assert.equal(sourcePageCap("student"), 200);
  assert.equal(courseGenerationCap("advanced"), 3);
  assert.equal(sourcePageCap("premium"), 500);
});
