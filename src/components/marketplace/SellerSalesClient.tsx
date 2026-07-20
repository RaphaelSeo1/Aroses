"use client";

import Link from "next/link";
import { useState } from "react";
import { formatPrice } from "@/lib/marketplace/listing-access";
import { useT } from "@/lib/i18n/LocaleProvider";
import { tf } from "@/lib/i18n/format";
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

export function SellerSalesClient({
  analytics,
}: {
  analytics: SellerSalesAnalytics;
}) {
  const t = useT();
  const { sales, byCourse, totals, payoutsReady } = analytics;
  const currency = totals.currency;
  const hasAnything = byCourse.length > 0 || sales.length > 0;
  const [payoutBusy, setPayoutBusy] = useState(false);
  const [payoutError, setPayoutError] = useState<string | null>(null);

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
      <header className="mb-8">
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
        <p className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
          {payoutError}
        </p>
      ) : null}

      <div className="mb-8 grid gap-3 sm:grid-cols-3">
        <StatCard label={t.sales.totalSales} value={String(totals.saleCount)} />
        <StatCard
          label={t.sales.grossRevenue}
          value={formatPrice(totals.grossCents, currency)}
        />
        <StatCard
          label={t.sales.yourEarnings}
          value={formatPrice(totals.netCents, currency)}
          hint={`${formatPrice(totals.feeCents, currency)} ${t.sales.platformFee}`}
        />
      </div>

      {!hasAnything ? (
        <EmptyCard
          title={t.sales.noListings}
          body={t.sales.noListingsBody}
        />
      ) : (
        <>
          <section className="mb-10">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              {t.sales.byCourse}
            </h2>
            <div className="overflow-hidden rounded-2xl border border-zinc-200/90 bg-white/95 dark:border-zinc-800 dark:bg-zinc-950/90">
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {byCourse.map((course) => (
                  <CourseRow key={course.courseId} course={course} />
                ))}
              </ul>
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              {t.sales.recentSales}
            </h2>
            {sales.length === 0 ? (
              <EmptyCard
                title={t.sales.noSalesYet}
                body={t.sales.noSalesYetBody}
              />
            ) : (
              <div className="overflow-x-auto overflow-hidden rounded-2xl border border-zinc-200/90 bg-white/95 dark:border-zinc-800 dark:bg-zinc-950/90">
                <div className="hidden min-w-[40rem] grid-cols-[1.2fr_1fr_0.7fr_0.7fr_0.7fr_0.55fr] gap-3 border-b border-zinc-100 px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:border-zinc-800 dark:text-zinc-500 sm:grid">
                  <span>{t.sales.course}</span>
                  <span>{t.sales.buyer}</span>
                  <span>{t.sales.date}</span>
                  <span>{t.sales.buyerPaid}</span>
                  <span>{t.sales.netToYou}</span>
                  <span>{t.sales.status}</span>
                </div>
                <ul className="min-w-[40rem] divide-y divide-zinc-100 dark:divide-zinc-800">
                  {sales.map((sale) => (
                    <li
                      key={sale.id}
                      className="grid gap-1 px-5 py-4 sm:grid-cols-[1.2fr_1fr_0.7fr_0.7fr_0.7fr_0.55fr] sm:items-center sm:gap-3"
                    >
                      <Link
                        href={`/dashboard/courses/${sale.courseId}`}
                        className="truncate text-sm font-semibold text-zinc-900 hover:text-brand dark:text-zinc-100 dark:hover:text-brand-soft"
                      >
                        {sale.courseTitle}
                      </Link>
                      <span className="truncate text-sm text-zinc-700 dark:text-zinc-300">
                        {sale.buyerLabel}
                      </span>
                      <span className="text-sm text-zinc-500 dark:text-zinc-400">
                        {formatSaleDate(sale.purchasedAt)}
                      </span>
                      <span className="text-sm tabular-nums text-zinc-700 dark:text-zinc-300">
                        {formatPrice(sale.priceCents, sale.currency)}
                      </span>
                      <span className="text-sm font-medium tabular-nums text-zinc-900 dark:text-zinc-100">
                        {sale.status === "completed"
                          ? formatPrice(sale.netCents, sale.currency)
                          : "—"}
                      </span>
                      <span
                        className={`text-sm font-medium ${
                          sale.status === "refunded"
                            ? "text-amber-700 dark:text-amber-400"
                            : "text-emerald-700 dark:text-emerald-400"
                        }`}
                      >
                        {statusLabel(sale.status, t.sales)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
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

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200/90 bg-white/95 p-5 dark:border-zinc-800 dark:bg-zinc-950/90">
      <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        {value}
      </p>
      {hint ? (
        <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function CourseRow({ course }: { course: SellerCourseSalesSummary }) {
  const t = useT();
  const salesLabel =
    course.saleCount === 0
      ? t.sales.zeroSales
      : course.saleCount === 1
        ? t.sales.salesOne
        : tf(t.sales.salesMany, { count: course.saleCount });

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
      <div className="min-w-0">
        <Link
          href={`/dashboard/courses/${course.courseId}`}
          className="truncate text-sm font-semibold text-zinc-900 hover:text-brand dark:text-zinc-100 dark:hover:text-brand-soft"
        >
          {course.courseTitle}
        </Link>
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
          {listingLabel(course.listingStatus, t.sales)}
          {course.priceCents != null
            ? ` · ${formatPrice(course.priceCents, course.currency)}`
            : null}
          {` · ${salesLabel}`}
        </p>
      </div>
      <div className="text-right">
        <p className="text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
          {formatPrice(course.netCents, course.currency)}
        </p>
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
          {t.sales.earned}
        </p>
      </div>
    </li>
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
