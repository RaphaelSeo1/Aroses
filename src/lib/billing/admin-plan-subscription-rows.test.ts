import assert from "node:assert/strict";
import test from "node:test";
import {
  isPaidPlanTier,
  listPriceCentsForTier,
  sortAdminPlanSubscriptionRows,
  startedAtFromSubscription,
  subscriberLabelFromParts,
  type AdminPlanSubscriptionRow,
} from "./admin-plan-subscription-rows.ts";

test("paid plan tiers are Student / Advanced / Premium only", () => {
  assert.equal(isPaidPlanTier("student"), true);
  assert.equal(isPaidPlanTier("advanced"), true);
  assert.equal(isPaidPlanTier("premium"), true);
  assert.equal(isPaidPlanTier("free"), false);
});

test("list prices match plan monthly USD", () => {
  assert.equal(listPriceCentsForTier("student"), 2900);
  assert.equal(listPriceCentsForTier("advanced"), 500);
  assert.equal(listPriceCentsForTier("premium"), 5900);
});

test("subscriber label prefers email then name then username", () => {
  assert.equal(
    subscriberLabelFromParts({
      email: "a@b.com",
      displayName: "Ada",
      username: "ada",
    }),
    "a@b.com"
  );
  assert.equal(
    subscriberLabelFromParts({ displayName: "Ada", username: "ada" }),
    "Ada"
  );
  assert.equal(subscriberLabelFromParts({ username: "ada" }), "@ada");
  assert.equal(subscriberLabelFromParts({}), "—");
});

test("started date falls back to updated_at", () => {
  assert.equal(
    startedAtFromSubscription({
      currentPeriodStart: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-02-01T00:00:00.000Z",
    }),
    "2026-01-01T00:00:00.000Z"
  );
  assert.equal(
    startedAtFromSubscription({
      currentPeriodStart: null,
      updatedAt: "2026-02-01T00:00:00.000Z",
    }),
    "2026-02-01T00:00:00.000Z"
  );
});

test("rows sort newest started first", () => {
  const older = {
    userId: "a",
    email: null,
    displayName: null,
    subscriberLabel: "a",
    tier: "student",
    amountCents: 2900,
    currency: "usd",
    status: "active",
    startedAt: "2026-01-01T00:00:00.000Z",
    periodEnd: null,
    cancelAtPeriodEnd: false,
    adminGranted: false,
  } satisfies AdminPlanSubscriptionRow;
  const newer = {
    ...older,
    userId: "b",
    subscriberLabel: "b",
    startedAt: "2026-03-01T00:00:00.000Z",
  };
  assert.deepEqual(sortAdminPlanSubscriptionRows([older, newer]).map((r) => r.userId), [
    "b",
    "a",
  ]);
});
