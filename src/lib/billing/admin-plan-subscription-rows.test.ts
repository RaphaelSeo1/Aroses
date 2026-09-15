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

test("paid plan tiers include Basic and Plus", () => {
  assert.equal(isPaidPlanTier("basic"), true);
  assert.equal(isPaidPlanTier("student"), true);
  assert.equal(isPaidPlanTier("plus"), true);
  assert.equal(isPaidPlanTier("advanced"), true);
  assert.equal(isPaidPlanTier("premium"), true);
  assert.equal(isPaidPlanTier("free"), false);
});

test("charged prices use promo monthly USD when promo is on", () => {
  const prev = process.env.SUBSCRIPTION_PROMO_ENABLED;
  process.env.SUBSCRIPTION_PROMO_ENABLED = "true";
  try {
    assert.equal(listPriceCentsForTier("basic"), 399);
    assert.equal(listPriceCentsForTier("student"), 1499);
    assert.equal(listPriceCentsForTier("plus"), 2499);
    assert.equal(listPriceCentsForTier("advanced"), 500);
    assert.equal(listPriceCentsForTier("premium"), 5999);
  } finally {
    process.env.SUBSCRIPTION_PROMO_ENABLED = prev;
  }
});

test("charged prices use regular monthly USD when promo is off", () => {
  const prev = process.env.SUBSCRIPTION_PROMO_ENABLED;
  process.env.SUBSCRIPTION_PROMO_ENABLED = "false";
  try {
    assert.equal(listPriceCentsForTier("basic"), 1999);
    assert.equal(listPriceCentsForTier("student"), 3999);
    assert.equal(listPriceCentsForTier("plus"), 5999);
    assert.equal(listPriceCentsForTier("advanced"), 7999);
    assert.equal(listPriceCentsForTier("premium"), 10999);
  } finally {
    process.env.SUBSCRIPTION_PROMO_ENABLED = prev;
  }
});

test("stored Stripe amount wins over catalog sale price", () => {
  const prev = process.env.SUBSCRIPTION_PROMO_ENABLED;
  process.env.SUBSCRIPTION_PROMO_ENABLED = "true";
  try {
    assert.equal(listPriceCentsForTier("advanced", 7999), 7999);
    assert.equal(listPriceCentsForTier("advanced", 0), 0);
    assert.equal(listPriceCentsForTier("advanced", null), 500);
    assert.equal(storedStripeAmountCents({ amount_cents: 500 }), 500);
    assert.equal(storedStripeAmountCents({ stripe_amount_cents: 7999 }), 7999);
    assert.equal(storedStripeAmountCents({}), null);
  } finally {
    process.env.SUBSCRIPTION_PROMO_ENABLED = prev;
  }
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
      tier: "premium",
      amountCents: 10999,
      status: "trialing",
    },
    {
      ...base,
      userId: "c",
      subscriberLabel: "c",
      tier: "advanced",
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

test("screenshot case: one paying Advanced at promo $5, admin Premiums excluded from MRR", () => {
  const prev = process.env.SUBSCRIPTION_PROMO_ENABLED;
  process.env.SUBSCRIPTION_PROMO_ENABLED = "true";
  try {
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
        userId: "paying-advanced",
        subscriberLabel: "rithwick70911@gmail.com",
        tier: "advanced",
        amountCents: listPriceCentsForTier("advanced"),
        status: "active",
        startedAt: "2026-09-09T00:00:00.000Z",
        adminGranted: false,
      },
      {
        ...base,
        userId: "admin-premium-1",
        subscriberLabel: "raphaelseo@berkeley.edu",
        tier: "premium",
        amountCents: listPriceCentsForTier("premium"),
        status: "active",
        adminGranted: true,
      },
      {
        ...base,
        userId: "admin-premium-2",
        subscriberLabel: "raphaelxseo@gmail.com",
        tier: "premium",
        amountCents: listPriceCentsForTier("premium"),
        status: "active",
        adminGranted: true,
      },
    ];

    assert.equal(rows[0].amountCents, 500);
    const summary = summarizeAdminPlanSubscriptions(rows);
    assert.equal(summary.subscriberCount, 3);
    assert.equal(summary.payingCount, 1);
    assert.equal(summary.mrrCents, 500);
  } finally {
    process.env.SUBSCRIPTION_PROMO_ENABLED = prev;
  }
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
