import assert from "node:assert/strict";
import test from "node:test";
import {
  isPaidPlanTier,
  listPriceCentsForTier,
  sortAdminPlanSubscriptionRows,
  startedAtFromSubscription,
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

test("list prices match regular plan monthly USD", () => {
  assert.equal(listPriceCentsForTier("basic"), 1999);
  assert.equal(listPriceCentsForTier("student"), 3999);
  assert.equal(listPriceCentsForTier("plus"), 5999);
  assert.equal(listPriceCentsForTier("advanced"), 7999);
  assert.equal(listPriceCentsForTier("premium"), 10999);
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
