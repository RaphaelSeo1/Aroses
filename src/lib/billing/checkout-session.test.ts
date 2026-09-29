import assert from "node:assert/strict";
import test from "node:test";
import { planCheckoutSessionParams } from "./checkout-session.ts";
import { PLANS } from "./plans.ts";
import { assertCheckoutTier, checkoutStripePriceId } from "./sale.ts";
import { STUDENT_TRIAL_DAYS } from "./student-trial.ts";

const STUDENT_PRICE = "price_student_recurring";
const OTHER_PRICE = "price_other_recurring";

function withTrialOn(fn: () => void) {
  const prev = process.env.STUDENT_TRIAL_ENABLED;
  process.env.STUDENT_TRIAL_ENABLED = "true";
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env.STUDENT_TRIAL_ENABLED;
    else process.env.STUDENT_TRIAL_ENABLED = prev;
  }
}

test("Student checkout is a subscription with a 3-day trial on the server price ID", () => {
  withTrialOn(() => {
    const params = planCheckoutSessionParams({
      customerId: "cus_test",
      priceId: STUDENT_PRICE,
      origin: "https://aroses.app",
      userId: "user_1",
      tier: "student",
    });

    assert.equal(params.mode, "subscription");
    assert.deepEqual(params.line_items, [
      { price: STUDENT_PRICE, quantity: 1 },
    ]);
    assert.equal(params.subscription_data?.trial_period_days, STUDENT_TRIAL_DAYS);
    assert.equal(params.subscription_data?.trial_period_days, 3);
  });
});

test("non-Student tiers stay subscriptions without a trial", () => {
  for (const tier of ["lite", "plus", "pro", "max"] as const) {
    const params = planCheckoutSessionParams({
      customerId: "cus_test",
      priceId: OTHER_PRICE,
      origin: "https://aroses.app",
      userId: "user_1",
      tier,
    });
    assert.equal(params.mode, "subscription", tier);
    assert.equal(
      params.subscription_data?.trial_period_days,
      undefined,
      tier
    );
  }
});

test("checkout helpers ignore a client-supplied price ID and only accept a paid tier", () => {
  assert.equal(assertCheckoutTier("student"), "student");
  assert.equal(assertCheckoutTier("price_evil"), null);
  assert.equal(assertCheckoutTier(" MAX "), "max");
  assert.equal(assertCheckoutTier("free"), null);
  // Old tier names can't be bought any more.
  assert.equal(assertCheckoutTier("advanced"), null);
  assert.equal(assertCheckoutTier("premium"), null);
  for (const tier of ["lite", "student", "plus", "pro", "max"] as const) {
    assert.equal(checkoutStripePriceId(tier), PLANS[tier].stripePriceId, tier);
  }
});
