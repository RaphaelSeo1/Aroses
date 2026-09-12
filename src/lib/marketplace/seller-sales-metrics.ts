import type {
  SellerCourseSalesSummary,
  SellerSaleRow,
  SellerSalesAnalytics,
} from "@/lib/marketplace/seller-sales";

export type SellerSalesKpis = {
  avgOrderCents: number;
  refundedCount: number;
  refundedCents: number;
  pendingCount: number;
  pendingCents: number;
  listingCount: number;
  listingLiveCount: number;
  listingPendingCount: number;
  dailyGrossCents: number[];
};

const MS_PER_DAY = 86_400_000;

export function dailyGrossCents(
  sales: Array<Pick<SellerSaleRow, "status" | "purchasedAt" | "priceCents">>,
  days: number,
  now: Date = new Date()
): number[] {
  const buckets = Array.from({ length: days }, () => 0);
  if (days <= 0) return buckets;

  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  const startMs = start.getTime();

  for (const sale of sales) {
    if (sale.status !== "completed" || !sale.purchasedAt) continue;
    const day = new Date(sale.purchasedAt);
    day.setHours(0, 0, 0, 0);
    const idx = Math.round((day.getTime() - startMs) / MS_PER_DAY);
    if (idx >= 0 && idx < days) buckets[idx] += sale.priceCents;
  }
  return buckets;
}

export function deriveSellerSalesKpis(
  analytics: SellerSalesAnalytics,
  now: Date = new Date()
): SellerSalesKpis {
  const refunded = analytics.sales.filter((sale) => sale.status === "refunded");
  const pending = analytics.sales.filter((sale) => sale.status === "pending");
  const saleCount = analytics.totals.saleCount;

  return {
    avgOrderCents:
      saleCount > 0
        ? Math.round(analytics.totals.grossCents / saleCount)
        : 0,
    refundedCount: refunded.length,
    refundedCents: refunded.reduce((sum, sale) => sum + sale.priceCents, 0),
    pendingCount: pending.length,
    pendingCents: pending.reduce((sum, sale) => sum + sale.priceCents, 0),
    listingCount: analytics.byCourse.length,
    listingLiveCount: analytics.byCourse.filter(
      (course) => course.listingStatus === "approved"
    ).length,
    listingPendingCount: analytics.byCourse.filter(
      (course) => course.listingStatus === "pending_review"
    ).length,
    dailyGrossCents: dailyGrossCents(analytics.sales, 14, now),
  };
}

export function courseRevenueShare(
  course: SellerCourseSalesSummary,
  maxNetCents: number
): number {
  if (maxNetCents <= 0 || course.netCents <= 0) return 0;
  return Math.min(100, (course.netCents / maxNetCents) * 100);
}
