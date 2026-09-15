import assert from "node:assert/strict";
import test from "node:test";
import {
  compareAtPriceMonthly,
  resolveCheckoutPriceId,
  salePriceMonthly,
} from "./sale.ts";
import { PLANS } from "./plans.ts";

test("promo ON charges promo recurring price IDs and shows regular as compare-at", () => {
  const prev = process.env.SUBSCRIPTION_PROMO_ENABLED;
  process.env.SUBSCRIPTION_PROMO_ENABLED = "true";
  try {
    assert.equal(salePriceMonthly("basic"), 3.99);
    assert.equal(salePriceMonthly("student"), 14.99);
    assert.equal(salePriceMonthly("plus"), 24.99);
    assert.equal(salePriceMonthly("advanced"), 5);
    assert.equal(salePriceMonthly("premium"), 59.99);
    assert.equal(compareAtPriceMonthly("advanced"), 79.99);
    assert.equal(compareAtPriceMonthly("premium"), 109.99);
    assert.equal(
      resolveCheckoutPriceId(
        { stripePriceId: "price_adv_reg", stripePromoPriceId: "price_adv_promo" },
        true
      ),
      "price_adv_promo"
    );
    assert.equal(
      resolveCheckoutPriceId(
        { stripePriceId: "price_stu_reg", stripePromoPriceId: "price_stu_promo" },
        true
      ),
      "price_stu_promo"
    );
  } finally {
    process.env.SUBSCRIPTION_PROMO_ENABLED = prev;
  }
});

test("promo OFF charges regular recurring price IDs with no strikethrough", () => {
  const prev = process.env.SUBSCRIPTION_PROMO_ENABLED;
  process.env.SUBSCRIPTION_PROMO_ENABLED = "false";
  try {
    assert.equal(salePriceMonthly("basic"), 19.99);
    assert.equal(salePriceMonthly("student"), 39.99);
    assert.equal(salePriceMonthly("plus"), 59.99);
    assert.equal(salePriceMonthly("advanced"), 79.99);
    assert.equal(salePriceMonthly("premium"), 109.99);
    assert.equal(compareAtPriceMonthly("advanced"), null);
    assert.equal(
      resolveCheckoutPriceId(
        { stripePriceId: "price_adv_reg", stripePromoPriceId: "price_adv_promo" },
        false
      ),
      "price_adv_reg"
    );
  } finally {
    process.env.SUBSCRIPTION_PROMO_ENABLED = prev;
  }
});

test("promo ON without a promo Price ID does not silently charge regular", () => {
  assert.equal(
    resolveCheckoutPriceId(
      { stripePriceId: "reg", stripePromoPriceId: null },
      true
    ),
    null
  );
});

test("each paid tier has distinct regular vs promo display prices while promo is on", () => {
  const prev = process.env.SUBSCRIPTION_PROMO_ENABLED;
  process.env.SUBSCRIPTION_PROMO_ENABLED = "true";
  try {
    for (const tier of ["basic", "student", "plus", "advanced", "premium"] as const) {
      assert.ok(salePriceMonthly(tier) < PLANS[tier].priceMonthly, tier);
    }
  } finally {
    process.env.SUBSCRIPTION_PROMO_ENABLED = prev;
  }
});
