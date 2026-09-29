import assert from "node:assert/strict";
import test from "node:test";
import {
  assertCheckoutTier,
  checkoutPriceEnvName,
  checkoutStripePriceId,
  compareAtPriceMonthly,
  salePercentForTier,
  salePriceMonthly,
} from "./sale.ts";
import { CHECKOUT_PLAN_ORDER, PLANS } from "./plans.ts";

test("cards show the real monthly price with no strike-through", () => {
  assert.equal(salePriceMonthly("lite"), 8.99);
  assert.equal(salePriceMonthly("student"), 14.99);
  assert.equal(salePriceMonthly("plus"), 29.99);
  assert.equal(salePriceMonthly("pro"), 49.99);
  assert.equal(salePriceMonthly("max"), 99.99);
  for (const tier of CHECKOUT_PLAN_ORDER) {
    assert.equal(compareAtPriceMonthly(tier), null, tier);
    assert.equal(salePercentForTier(tier), 0, tier);
  }
});

test("the old promo flag no longer changes prices", () => {
  const prev = process.env.SUBSCRIPTION_PROMO_ENABLED;
  process.env.SUBSCRIPTION_PROMO_ENABLED = "true";
  try {
    assert.equal(salePriceMonthly("student"), PLANS.student.priceMonthly);
    assert.equal(compareAtPriceMonthly("plus"), null);
  } finally {
    if (prev === undefined) delete process.env.SUBSCRIPTION_PROMO_ENABLED;
    else process.env.SUBSCRIPTION_PROMO_ENABLED = prev;
  }
});

test("checkout charges the server-side price for each tier", () => {
  for (const tier of CHECKOUT_PLAN_ORDER) {
    assert.equal(checkoutStripePriceId(tier), PLANS[tier].stripePriceId, tier);
    assert.equal(checkoutPriceEnvName(tier), `STRIPE_PRICE_${tier.toUpperCase()}_MONTHLY`);
  }
  assert.equal(assertCheckoutTier("pro"), "pro");
  assert.equal(assertCheckoutTier("price_evil"), null);
  assert.equal(assertCheckoutTier(42), null);
});
