"use client";

import { formatPrice } from "@/lib/marketplace/listing-access";
import { useT } from "@/lib/i18n/LocaleProvider";
import type { AdminPlanSubscriptionRow } from "@/lib/billing/admin-plan-subscription-rows";

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function planLabel(
  tier: AdminPlanSubscriptionRow["tier"],
  t: ReturnType<typeof useT>
): string {
  switch (tier) {
    case "student":
      return t.billing.planStudent;
    case "advanced":
      return t.billing.planAdvanced;
    case "premium":
      return t.billing.planPremium;
    default:
      return tier;
  }
}

function statusLabel(
  status: string,
  t: ReturnType<typeof useT>["sales"]
): string {
  switch (status) {
    case "active":
      return t.adminActive;
    case "canceled":
      return t.adminCanceled;
    case "past_due":
      return t.adminPastDue;
    case "trialing":
      return t.adminTrialing;
    case "inactive":
      return t.adminInactive;
    case "incomplete":
    case "incomplete_expired":
      return t.adminIncomplete;
    case "unpaid":
      return t.adminUnpaid;
    default:
      return status.replace(/_/g, " ");
  }
}

function statusClass(status: string): string {
  switch (status) {
    case "canceled":
    case "incomplete_expired":
    case "inactive":
      return "text-zinc-500 dark:text-zinc-400";
    case "past_due":
    case "unpaid":
    case "incomplete":
      return "text-amber-700 dark:text-amber-400";
    default:
      return "text-emerald-700 dark:text-emerald-400";
  }
}

export function AdminPlanSubscriptionsSection({
  subscriptions,
}: {
  subscriptions: AdminPlanSubscriptionRow[];
}) {
  const t = useT();

  return (
    <section className="mb-12">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
          {t.sales.adminPlansTitle}
        </h2>
        <span className="rounded-full bg-zinc-900 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white dark:bg-zinc-100 dark:text-zinc-900">
          {t.sales.adminBadge}
        </span>
      </div>
      <p className="mb-4 max-w-2xl text-pretty text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
        {t.sales.adminPlansSubtitle}
      </p>

      {subscriptions.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-300 bg-white/60 px-5 py-10 text-center dark:border-zinc-700 dark:bg-zinc-950/40">
          <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
            {t.sales.adminPlansEmpty}
          </p>
          <p className="mx-auto mt-2 max-w-md text-sm text-zinc-500 dark:text-zinc-400">
            {t.sales.adminPlansEmptyBody}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto overflow-hidden rounded-2xl border border-zinc-200/90 bg-white/95 dark:border-zinc-800 dark:bg-zinc-950/90">
          <div className="hidden min-w-[44rem] grid-cols-[1.3fr_0.8fr_0.7fr_0.8fr_0.8fr] gap-3 border-b border-zinc-100 px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:border-zinc-800 dark:text-zinc-500 sm:grid">
            <span>{t.sales.adminSubscriber}</span>
            <span>{t.sales.adminPlan}</span>
            <span>{t.sales.adminAmount}</span>
            <span>{t.sales.adminStarted}</span>
            <span>{t.sales.status}</span>
          </div>
          <ul className="min-w-[44rem] divide-y divide-zinc-100 dark:divide-zinc-800">
            {subscriptions.map((row) => (
              <li
                key={row.userId}
                className="grid gap-1 px-5 py-4 sm:grid-cols-[1.3fr_0.8fr_0.7fr_0.8fr_0.8fr] sm:items-center sm:gap-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    {row.subscriberLabel}
                  </p>
                  {row.displayName &&
                  row.email &&
                  row.displayName !== row.subscriberLabel ? (
                    <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                      {row.displayName}
                    </p>
                  ) : null}
                </div>
                <span className="text-sm text-zinc-700 dark:text-zinc-300">
                  {planLabel(row.tier, t)}
                </span>
                <span className="text-sm tabular-nums text-zinc-700 dark:text-zinc-300">
                  {formatPrice(row.amountCents, row.currency)}
                  {t.billing.perMonth}
                </span>
                <span className="text-sm text-zinc-500 dark:text-zinc-400">
                  {formatWhen(row.startedAt)}
                </span>
                <div>
                  <p className={`text-sm font-medium ${statusClass(row.status)}`}>
                    {statusLabel(row.status, t.sales)}
                  </p>
                  {row.adminGranted ? (
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                      {t.sales.adminGrantedNote}
                    </p>
                  ) : null}
                  {row.cancelAtPeriodEnd ? (
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                      {t.sales.adminCanceling}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
