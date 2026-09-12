import assert from "node:assert/strict";
import test from "node:test";
import type { SellerSalesAnalytics } from "./seller-sales.ts";
import {
  courseRevenueShare,
  dailyGrossCents,
  deriveSellerSalesKpis,
} from "./seller-sales-metrics.ts";

const emptyAnalytics: SellerSalesAnalytics = {
  sales: [],
  byCourse: [],
  totals: {
    saleCount: 0,
    grossCents: 0,
    feeCents: 0,
    netCents: 0,
    currency: "usd",
  },
  payoutsReady: false,
};

test("avg order is gross divided by completed sales", () => {
  const kpis = deriveSellerSalesKpis({
    ...emptyAnalytics,
    totals: {
      ...emptyAnalytics.totals,
      saleCount: 2,
      grossCents: 5000,
    },
  });
  assert.equal(kpis.avgOrderCents, 2500);
});

test("zero sales keeps avg order at 0", () => {
  assert.equal(deriveSellerSalesKpis(emptyAnalytics).avgOrderCents, 0);
});

test("pending and refunded come from sale rows, not completed totals", () => {
  const kpis = deriveSellerSalesKpis({
    ...emptyAnalytics,
    sales: [
      {
        id: "1",
        courseId: "c1",
        courseTitle: "A",
        buyerUserId: "b1",
        buyerLabel: "Ada",
        priceCents: 2000,
        platformFeeCents: 200,
        netCents: 1800,
        currency: "usd",
        status: "completed",
        purchasedAt: "2026-09-01T00:00:00.000Z",
      },
      {
        id: "2",
        courseId: "c1",
        courseTitle: "A",
        buyerUserId: "b2",
        buyerLabel: "Bea",
        priceCents: 1500,
        platformFeeCents: 150,
        netCents: 1350,
        currency: "usd",
        status: "refunded",
        purchasedAt: "2026-09-02T00:00:00.000Z",
      },
      {
        id: "3",
        courseId: "c2",
        courseTitle: "B",
        buyerUserId: "b3",
        buyerLabel: "Cid",
        priceCents: 900,
        platformFeeCents: 90,
        netCents: 810,
        currency: "usd",
        status: "pending",
        purchasedAt: "2026-09-03T00:00:00.000Z",
      },
    ],
    totals: {
      saleCount: 1,
      grossCents: 2000,
      feeCents: 200,
      netCents: 1800,
      currency: "usd",
    },
  });
  assert.equal(kpis.refundedCount, 1);
  assert.equal(kpis.refundedCents, 1500);
  assert.equal(kpis.pendingCount, 1);
  assert.equal(kpis.pendingCents, 900);
  assert.equal(kpis.avgOrderCents, 2000);
});

test("listing KPIs count live and pending review rows", () => {
  const kpis = deriveSellerSalesKpis({
    ...emptyAnalytics,
    byCourse: [
      {
        courseId: "a",
        courseTitle: "A",
        listingStatus: "approved",
        priceCents: 1000,
        currency: "usd",
        saleCount: 1,
        grossCents: 1000,
        netCents: 800,
      },
      {
        courseId: "b",
        courseTitle: "B",
        listingStatus: "pending_review",
        priceCents: 2000,
        currency: "usd",
        saleCount: 0,
        grossCents: 0,
        netCents: 0,
      },
      {
        courseId: "c",
        courseTitle: "C",
        listingStatus: "rejected",
        priceCents: 500,
        currency: "usd",
        saleCount: 0,
        grossCents: 0,
        netCents: 0,
      },
    ],
  });
  assert.equal(kpis.listingCount, 3);
  assert.equal(kpis.listingLiveCount, 1);
  assert.equal(kpis.listingPendingCount, 1);
});

test("daily gross buckets completed sales into local days", () => {
  const now = new Date("2026-09-12T15:00:00.000Z");
  const today = new Date(now);
  today.setHours(12, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const buckets = dailyGrossCents(
    [
      {
        status: "completed",
        purchasedAt: today.toISOString(),
        priceCents: 300,
      },
      {
        status: "completed",
        purchasedAt: yesterday.toISOString(),
        priceCents: 100,
      },
      {
        status: "refunded",
        purchasedAt: today.toISOString(),
        priceCents: 999,
      },
    ],
    3,
    now
  );

  assert.deepEqual(buckets, [0, 100, 300]);
});

test("course revenue share is 0 when nothing has earned", () => {
  assert.equal(
    courseRevenueShare(
      {
        courseId: "a",
        courseTitle: "A",
        listingStatus: "approved",
        priceCents: 1000,
        currency: "usd",
        saleCount: 0,
        grossCents: 0,
        netCents: 0,
      },
      0
    ),
    0
  );
});
