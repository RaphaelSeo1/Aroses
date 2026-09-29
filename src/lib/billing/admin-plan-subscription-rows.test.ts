import assert from "node:assert/strict";
import test from "node:test";
import {
  isPaidPlanTier,
  listPriceCentsForTier,
  sortAdminPlanSubscriptionRows,
  startedAtFromSubscription,
  storedStripeAmountCents,
  subscriberLabelFromParts,
  summarizeAdminPlanSubscriptions,
  type AdminPlanSubscriptionRow,
} from "./admin-plan-subscription-rows.ts";

test("paid plan tiers are Lite, Student, Plus, Pro, Max", () => {
  for (const tier of ["lite", "student", "plus", "pro", "max"]) {
    assert.equal(isPaidPlanTier(tier), true, tier);
  }
  assert.equal(isPaidPlanTier("free"), false);
});

test("charged prices are the plan's monthly USD", () => {
  assert.equal(listPriceCentsForTier("lite"), 899);
  assert.equal(listPriceCentsForTier("student"), 1499);
  assert.equal(listPriceCentsForTier("plus"), 2999);
  assert.equal(listPriceCentsForTier("pro"), 4999);
  assert.equal(listPriceCentsForTier("max"), 9999);
});

test("stored Stripe amount wins over the catalog price", () => {
  assert.equal(listPriceCentsForTier("plus", 500), 500);
  assert.equal(listPriceCentsForTier("plus", 0), 0);
  assert.equal(listPriceCentsForTier("plus", null), 2999);
  assert.equal(storedStripeAmountCents({ amount_cents: 500 }), 500);
  assert.equal(storedStripeAmountCents({ stripe_amount_cents: 7999 }), 7999);
  assert.equal(storedStripeAmountCents({}), null);
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

test("plan KPIs count current subscribers and paying MRR only", () => {
  const base = {
    email: null,
    displayName: null,
    currency: "usd",
    startedAt: "2026-01-01T00:00:00.000Z",
    periodEnd: null,
    cancelAtPeriodEnd: false,
    adminGranted: false,
  } as const;

  const rows: AdminPlanSubscriptionRow[] = [
    {
      ...base,
      userId: "a",
      subscriberLabel: "a",
      tier: "student",
      amountCents: 3999,
      status: "active",
    },
    {
      ...base,
      userId: "b",
      subscriberLabel: "b",
      tier: "pro",
      amountCents: 10999,
      status: "trialing",
    },
    {
      ...base,
      userId: "c",
      subscriberLabel: "c",
      tier: "plus",
      amountCents: 7999,
      status: "active",
      adminGranted: true,
    },
    {
      ...base,
      userId: "d",
      subscriberLabel: "d",
      tier: "student",
      amountCents: 3999,
      status: "canceled",
    },
  ];

  const summary = summarizeAdminPlanSubscriptions(rows);
  assert.equal(summary.subscriberCount, 3);
  assert.equal(summary.payingCount, 2);
  assert.equal(summary.mrrCents, 14998);
});

test("one paying old-Advanced subscriber (now Plus) at their $5 Stripe price; admin grants excluded from MRR", () => {
  const base = {
    email: null,
    displayName: null,
    currency: "usd" as const,
    startedAt: "2026-07-24T00:00:00.000Z",
    periodEnd: null,
    cancelAtPeriodEnd: false,
  };

  const rows: AdminPlanSubscriptionRow[] = [
    {
      ...base,
      userId: "paying-plus",
      subscriberLabel: "paying@example.com",
      tier: "plus",
      amountCents: listPriceCentsForTier("plus", 500),
      status: "active",
      startedAt: "2026-09-09T00:00:00.000Z",
      adminGranted: false,
    },
    {
      ...base,
      userId: "admin-pro-1",
      subscriberLabel: "admin1@example.com",
      tier: "pro",
      amountCents: listPriceCentsForTier("pro"),
      status: "active",
      adminGranted: true,
    },
    {
      ...base,
      userId: "admin-pro-2",
      subscriberLabel: "admin2@example.com",
      tier: "pro",
      amountCents: listPriceCentsForTier("pro"),
      status: "active",
      adminGranted: true,
    },
  ];

  const summary = summarizeAdminPlanSubscriptions(rows);
  assert.equal(summary.subscriberCount, 3);
  assert.equal(summary.payingCount, 1);
  assert.equal(summary.mrrCents, 500);
});

test("rows sort newest started first", () => {
  const older = {
    userId: "a",
    email: null,
    displayName: null,
    subscriberLabel: "a",
    tier: "student",
    amountCents: 3999,
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
