import assert from "node:assert/strict";
import test from "node:test";
import {
  CHECKOUT_PLAN_ORDER,
  PLANS,
  courseGenerationCap,
  generationDepthForTier,
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
      depth: string;
      early: boolean;
      regular: number;
      promo: number;
    }
  > = {
    basic: {
      gens: 1,
      pages: 100,
      pdfs: 3,
      voiceMin: 60,
      recordings: 2,
      depth: "essential",
      early: false,
      regular: 19.99,
      promo: 3.99,
    },
    student: {
      gens: 3,
      pages: 250,
      pdfs: 6,
      voiceMin: 240,
      recordings: 8,
      depth: "standard",
      early: false,
      regular: 39.99,
      promo: 14.99,
    },
    plus: {
      gens: 5,
      pages: 400,
      pdfs: 10,
      voiceMin: 420,
      recordings: 15,
      depth: "detailed",
      early: false,
      regular: 59.99,
      promo: 24.99,
    },
    advanced: {
      gens: 10,
      pages: 750,
      pdfs: 15,
      voiceMin: 600,
      recordings: 25,
      depth: "comprehensive",
      early: true,
      regular: 79.99,
      promo: 5,
    },
    premium: {
      gens: 20,
      pages: 1000,
      pdfs: 25,
      voiceMin: 1500,
      recordings: 40,
      depth: "maximum",
      early: true,
      regular: 109.99,
      promo: 59,
    },
  };

  for (const tier of CHECKOUT_PLAN_ORDER) {
    const e = expected[tier];
    assert.equal(courseGenerationCap(tier), e.gens, tier);
    assert.equal(sourcePageCap(tier), e.pages, tier);
    assert.equal(maxPdfsPerCourse(tier), e.pdfs, tier);
    assert.equal(voiceCapSeconds(tier), e.voiceMin * 60, tier);
    assert.equal(lectureRecordingCap(tier), e.recordings, tier);
    assert.equal(generationDepthForTier(tier), e.depth, tier);
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
  assert.equal(sourcePageCap("student"), 250);
  assert.notEqual(sourcePageCap("student"), sourcePageCap("basic") + 250);
  assert.equal(courseGenerationCap("advanced"), 10);
  assert.equal(sourcePageCap("premium"), 1000);
});
