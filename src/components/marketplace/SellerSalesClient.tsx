"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { formatPrice } from "@/lib/marketplace/listing-access";
import { DismissibleInlineBanner } from "@/components/DismissibleInlineBanner";
import { useT } from "@/lib/i18n/LocaleProvider";
import { tf } from "@/lib/i18n/format";
import type { AdminPlanSubscriptionRow } from "@/lib/billing/admin-plan-subscription-rows";
import { summarizeAdminPlanSubscriptions } from "@/lib/billing/admin-plan-subscription-rows";
import { AdminPlanSubscriptionsSection } from "@/components/marketplace/AdminPlanSubscriptionsSection";
import {
  courseRevenueShare,
  deriveSellerSalesKpis,
} from "@/lib/marketplace/seller-sales-metrics";
import type {
  SellerCourseSalesSummary,
  SellerSaleRow,
  SellerSalesAnalytics,
} from "@/lib/marketplace/seller-sales";

function formatSaleDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function listingLabel(
  status: string | null,
  t: ReturnType<typeof useT>["sales"]
): string {
  switch (status) {
    case "approved":
      return t.listingApproved;
    case "pending_review":
      return t.listingPending;
    case "rejected":
      return t.listingRejected;
    default:
      return t.listingUnknown;
  }
}

function statusLabel(
  status: SellerSaleRow["status"],
  t: ReturnType<typeof useT>["sales"]
): string {
  switch (status) {
    case "refunded":
      return t.refunded;
    case "pending":
      return t.pending;
    default:
      return t.completed;
  }
}

function statusClass(status: SellerSaleRow["status"]): string {
  switch (status) {
    case "refunded":
      return "text-amber-700 dark:text-amber-400";
    case "pending":
      return "text-zinc-500 dark:text-zinc-400";
    default:
      return "text-emerald-700 dark:text-emerald-400";
  }
}

export function SellerSalesClient({
  analytics,
  planSubscriptions = null,
}: {
  analytics: SellerSalesAnalytics;
  planSubscriptions?: AdminPlanSubscriptionRow[] | null;
}) {
  const t = useT();
  const { sales, byCourse, totals, payoutsReady } = analytics;
  const currency = totals.currency;
  const hasAnything = byCourse.length > 0 || sales.length > 0;
  const [payoutBusy, setPayoutBusy] = useState(false);
  const [payoutError, setPayoutError] = useState<string | null>(null);
  const kpis = useMemo(() => deriveSellerSalesKpis(analytics), [analytics]);
  const planSummary = useMemo(
    () =>
      planSubscriptions
        ? summarizeAdminPlanSubscriptions(planSubscriptions)
        : null,
    [planSubscriptions]
  );
  const maxCourseNet = useMemo(
    () => Math.max(0, ...byCourse.map((course) => course.netCents)),
    [byCourse]
  );

  async function openPayouts() {
    if (payoutBusy) return;
    setPayoutError(null);
    setPayoutBusy(true);
    try {
      const res = await fetch("/api/marketplace/connect/login", {
        method: "POST",
      });
      const data = (await res.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
      };
      if (!res.ok || !data.url) {
        throw new Error(
          data.error ??
            (payoutsReady ? t.sales.payoutsError : t.sales.setupPayoutsFirst)
        );
      }
      window.location.href = data.url;
    } catch (err) {
      setPayoutError(
        err instanceof Error ? err.message : t.sales.payoutsError
      );
      setPayoutBusy(false);
    }
  }

  return (
    <div>
      <header className="mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {t.sales.title}
          </h1>
          <button
            type="button"
            onClick={() => void openPayouts()}
            disabled={payoutBusy}
            className="inline-flex shrink-0 items-center rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-hover disabled:opacity-60"
          >
            {payoutBusy ? t.sales.openingPayouts : t.sales.openPayouts}
          </button>
        </div>
        <p className="mt-2 max-w-2xl text-pretty text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          {t.sales.subtitle}
        </p>
      </header>

      {payoutError ? (
        <DismissibleInlineBanner
          className="mb-6"
          onDismiss={() => setPayoutError(null)}
        >
          {payoutError}
        </DismissibleInlineBanner>
      ) : null}

      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        <MetricCard
          label={t.sales.grossRevenue}
          value={formatPrice(totals.grossCents, currency)}
          hint={tf(t.sales.platformFeeHint, {
            amount: formatPrice(totals.feeCents, currency),
          })}
        >
          <SparkBars
            values={kpis.dailyGrossCents}
            label={t.sales.lastFourteenDays}
          />
        </MetricCard>
        <MetricCard
          label={t.sales.totalSales}
          value={totals.saleCount.toLocaleString()}
          hint={
            kpis.refundedCount > 0
              ? `${formatPrice(kpis.refundedCents, currency)} ${t.sales.refundedAmount.toLowerCase()}`
              : tf(t.sales.completedHint, { count: totals.saleCount })
          }
        />
        <MetricCard
          label={t.sales.payout}
          value={formatPrice(totals.netCents, currency)}
          hint={
            payoutsReady ? t.sales.payoutHintReady : t.sales.payoutHintSetup
          }
        />
        <MetricCard
          label={t.sales.avgOrder}
          value={formatPrice(kpis.avgOrderCents, currency)}
          hint={tf(t.sales.completedHint, { count: totals.saleCount })}
        />
        <MetricCard
          label={t.sales.pendingCheckout}
          value={formatPrice(kpis.pendingCents, currency)}
          hint={tf(t.sales.pendingCheckoutHint, { count: kpis.pendingCount })}
        />
        <MetricCard
          label={t.sales.liveListings}
          value={kpis.listingLiveCount.toLocaleString()}
          hint={
            kpis.listingPendingCount > 0
              ? tf(t.sales.listingsPendingHint, {
                  count: kpis.listingPendingCount,
                })
              : tf(t.sales.listingsTotalHint, { count: kpis.listingCount })
          }
        />
        {planSummary ? (
          <>
            <MetricCard
              label={t.sales.subscribers}
              value={planSummary.subscriberCount.toLocaleString()}
              hint={tf(t.sales.payingHint, { count: planSummary.payingCount })}
            />
            <MetricCard
              label={t.sales.mrr}
              value={formatPrice(planSummary.mrrCents, planSummary.currency)}
              hint={t.sales.mrrHint}
            />
          </>
        ) : null}
      </div>

      {planSubscriptions ? (
        <AdminPlanSubscriptionsSection subscriptions={planSubscriptions} />
      ) : null}

      {!hasAnything ? (
        <EmptyCard
          title={t.sales.noListings}
          body={t.sales.noListingsBody}
        />
      ) : (
        <>
          <section className="mb-10">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                {t.sales.byCourse}
              </h2>
              <p className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                {tf(t.sales.listingsTotalHint, { count: byCourse.length })}
                {" · "}
                {formatPrice(totals.netCents, currency)} {t.sales.earned}
              </p>
            </div>
            <TableShell>
              <table className="min-w-[44rem] w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-zinc-200 bg-zinc-50/90 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/80 dark:text-zinc-400">
                    <th className="px-4 py-2.5 font-semibold">{t.sales.course}</th>
                    <th className="px-4 py-2.5 font-semibold">{t.sales.status}</th>
                    <th className="px-4 py-2.5 text-right font-semibold">
                      {t.sales.listPrice}
                    </th>
                    <th className="px-4 py-2.5 text-right font-semibold">
                      {t.sales.salesCount}
                    </th>
                    <th className="px-4 py-2.5 text-right font-semibold">
                      {t.sales.grossRevenue}
                    </th>
                    <th className="px-4 py-2.5 text-right font-semibold">
                      {t.sales.earned}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {byCourse.map((course) => (
                    <CourseTableRow
                      key={course.courseId}
                      course={course}
                      share={courseRevenueShare(course, maxCourseNet)}
                    />
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-zinc-200 bg-zinc-50/70 text-sm dark:border-zinc-800 dark:bg-zinc-900/50">
                    <td className="px-4 py-3 font-semibold text-zinc-800 dark:text-zinc-200">
                      {t.sales.tableTotal}
                    </td>
                    <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400">
                      —
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-zinc-500 dark:text-zinc-400">
                      —
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold text-zinc-800 dark:text-zinc-200">
                      {totals.saleCount.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold text-zinc-800 dark:text-zinc-200">
                      {formatPrice(totals.grossCents, currency)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold text-zinc-900 dark:text-zinc-50">
                      {formatPrice(totals.netCents, currency)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </TableShell>
          </section>

          <section>
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                {t.sales.recentSales}
              </h2>
              <p className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                {tf(t.sales.completedHint, { count: totals.saleCount })}
                {kpis.pendingCount > 0
                  ? ` · ${tf(t.sales.pendingCheckoutHint, { count: kpis.pendingCount })}`
                  : null}
              </p>
            </div>
            {sales.length === 0 ? (
              <EmptyCard
                title={t.sales.noSalesYet}
                body={t.sales.noSalesYetBody}
              />
            ) : (
              <TableShell>
                <table className="min-w-[46rem] w-full border-collapse text-left">
                  <thead>
                    <tr className="border-b border-zinc-200 bg-zinc-50/90 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/80 dark:text-zinc-400">
                      <th className="px-4 py-2.5 font-semibold">{t.sales.buyer}</th>
                      <th className="px-4 py-2.5 font-semibold">{t.sales.item}</th>
                      <th className="px-4 py-2.5 text-right font-semibold">
                        {t.sales.amount}
                      </th>
                      <th className="px-4 py-2.5 font-semibold">{t.sales.date}</th>
                      <th className="px-4 py-2.5 font-semibold">{t.sales.status}</th>
                      <th className="px-4 py-2.5 text-right font-semibold">
                        {t.sales.netToYou}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sales.map((sale, index) => (
                      <tr
                        key={sale.id}
                        className={
                          index % 2 === 0
                            ? "bg-white dark:bg-zinc-950/40"
                            : "bg-zinc-50/50 dark:bg-zinc-900/30"
                        }
                      >
                        <td className="border-t border-zinc-100 px-4 py-3 dark:border-zinc-800">
                          <span className="block max-w-[14rem] truncate text-sm text-zinc-700 dark:text-zinc-300">
                            {sale.buyerLabel}
                          </span>
                        </td>
                        <td className="border-t border-zinc-100 px-4 py-3 dark:border-zinc-800">
                          <Link
                            href={`/dashboard/courses/${sale.courseId}`}
                            className="block max-w-[16rem] truncate text-sm font-semibold text-zinc-900 hover:text-brand dark:text-zinc-100 dark:hover:text-brand-soft"
                          >
                            {sale.courseTitle}
                          </Link>
                        </td>
                        <td className="border-t border-zinc-100 px-4 py-3 text-right text-sm tabular-nums text-zinc-700 dark:border-zinc-800 dark:text-zinc-300">
                          {formatPrice(sale.priceCents, sale.currency)}
                        </td>
                        <td className="border-t border-zinc-100 px-4 py-3 text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                          {formatSaleDate(sale.purchasedAt)}
                        </td>
                        <td
                          className={`border-t border-zinc-100 px-4 py-3 text-sm font-medium dark:border-zinc-800 ${statusClass(sale.status)}`}
                        >
                          {statusLabel(sale.status, t.sales)}
                        </td>
                        <td className="border-t border-zinc-100 px-4 py-3 text-right text-sm font-medium tabular-nums text-zinc-900 dark:border-zinc-800 dark:text-zinc-100">
                          {sale.status === "completed"
                            ? formatPrice(sale.netCents, sale.currency)
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-zinc-200 bg-zinc-50/70 text-sm dark:border-zinc-800 dark:bg-zinc-900/50">
                      <td className="px-4 py-3 font-semibold text-zinc-800 dark:text-zinc-200">
                        {t.sales.tableTotal}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-zinc-500 dark:text-zinc-400">
                        {sales.length.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold text-zinc-800 dark:text-zinc-200">
                        {formatPrice(totals.grossCents, currency)}
                      </td>
                      <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400">
                        —
                      </td>
                      <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400">
                        —
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold text-zinc-900 dark:text-zinc-50">
                        {formatPrice(totals.netCents, currency)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </TableShell>
            )}
          </section>
        </>
      )}

      <p className="mt-8 max-w-2xl text-pretty text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
        {t.sales.payoutsNote}
      </p>
    </div>
  );
}

function MetricCard({
  label,
  value,
  hint,
  children,
}: {
  label: string;
  value: string;
  hint?: string;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-zinc-200/80 bg-white/95 p-3.5 shadow-sm shadow-zinc-900/[0.02] dark:border-zinc-800 dark:bg-zinc-950/90 dark:shadow-black/20">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        {label}
      </p>
      <p className="mt-1.5 text-xl font-semibold tabular-nums tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-2xl">
        {value}
      </p>
      {hint ? (
        <p className="mt-1 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
          {hint}
        </p>
      ) : null}
      {children}
    </div>
  );
}

function SparkBars({ values, label }: { values: number[]; label: string }) {
  const max = Math.max(...values, 0);
  return (
    <div
      className="mt-3 flex h-8 items-end gap-0.5"
      role="img"
      aria-label={label}
    >
      {values.map((value, index) => (
        <span
          key={index}
          className={`min-h-px flex-1 rounded-sm ${
            value > 0
              ? "bg-brand/70 dark:bg-brand-soft/70"
              : "bg-zinc-200 dark:bg-zinc-800"
          }`}
          style={{ height: value > 0 && max > 0 ? `${Math.max(12, (value / max) * 100)}%` : 2 }}
        />
      ))}
    </div>
  );
}

function TableShell({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200/90 bg-white/95 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/90">
      {children}
    </div>
  );
}

function CourseTableRow({
  course,
  share,
}: {
  course: SellerCourseSalesSummary;
  share: number;
}) {
  const t = useT();
  return (
    <tr className="align-middle">
      <td className="border-t border-zinc-100 px-4 py-3 dark:border-zinc-800">
        <Link
          href={`/dashboard/courses/${course.courseId}`}
          className="block max-w-[16rem] truncate text-sm font-semibold text-zinc-900 hover:text-brand dark:text-zinc-100 dark:hover:text-brand-soft"
        >
          {course.courseTitle}
        </Link>
        <span
          className="mt-1.5 block h-1 max-w-[10rem] overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"
          aria-hidden
        >
          <span
            className="block h-full rounded-full bg-brand/70 dark:bg-brand-soft/70"
            style={{ width: `${share}%` }}
          />
        </span>
      </td>
      <td className="border-t border-zinc-100 px-4 py-3 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
        {listingLabel(course.listingStatus, t.sales)}
      </td>
      <td className="border-t border-zinc-100 px-4 py-3 text-right text-sm tabular-nums text-zinc-700 dark:border-zinc-800 dark:text-zinc-300">
        {course.priceCents != null
          ? formatPrice(course.priceCents, course.currency)
          : "—"}
      </td>
      <td className="border-t border-zinc-100 px-4 py-3 text-right text-sm tabular-nums text-zinc-700 dark:border-zinc-800 dark:text-zinc-300">
        {course.saleCount.toLocaleString()}
      </td>
      <td className="border-t border-zinc-100 px-4 py-3 text-right text-sm tabular-nums text-zinc-700 dark:border-zinc-800 dark:text-zinc-300">
        {formatPrice(course.grossCents, course.currency)}
      </td>
      <td className="border-t border-zinc-100 px-4 py-3 text-right text-sm font-semibold tabular-nums text-zinc-900 dark:border-zinc-800 dark:text-zinc-100">
        {formatPrice(course.netCents, course.currency)}
      </td>
    </tr>
  );
}

function EmptyCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-zinc-300 bg-white/60 px-5 py-10 text-center dark:border-zinc-700 dark:bg-zinc-950/40">
      <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
        {title}
      </p>
      <p className="mx-auto mt-2 max-w-md text-sm text-zinc-500 dark:text-zinc-400">
        {body}
      </p>
    </div>
  );
}
