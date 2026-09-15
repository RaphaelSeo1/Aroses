"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  CHECKOUT_PLAN_ORDER,
  formatUsdAmount,
  isPaidTier,
  voiceHours,
  type PlanTier,
} from "@/lib/billing/plans";
import {
  compareAtPriceMonthly,
  salePriceMonthly,
  salePercentForTier,
} from "@/lib/billing/sale";
import { isStudentTrialActive } from "@/lib/billing/student-trial";
import { useT } from "@/lib/i18n/LocaleProvider";
import { tf } from "@/lib/i18n/format";
import type { Dictionary } from "@/locales";

function planStrings(t: Dictionary["billing"], tier: PlanTier) {
  const names: Record<PlanTier, string> = {
    free: t.planFree,
    basic: t.planBasic,
    student: t.planStudent,
    plus: t.planPlus,
    advanced: t.planAdvanced,
    premium: t.planPremium,
  };
  const taglines: Record<PlanTier, string> = {
    free: t.planFreeTag,
    basic: t.planBasicTag,
    student: t.planStudentTag,
    plus: t.planPlusTag,
    advanced: t.planAdvancedTag,
    premium: t.planPremiumTag,
  };
  const includes: Record<PlanTier, string | null> = {
    free: null,
    basic: t.planBasicIncludes,
    student: t.planStudentIncludes,
    plus: t.planPlusIncludes,
    advanced: t.planAdvancedIncludes,
    premium: t.planPremiumIncludes,
  };
  const highlights: Record<PlanTier, string[]> = {
    free: [t.planFreeHighlight1, t.planFreeHighlight2, t.planFreeHighlight3],
    basic: [
      t.planBasicHighlight1,
      t.planBasicHighlight2,
      t.planBasicHighlight3,
      t.planBasicHighlight4,
      t.planBasicHighlight5,
      t.planBasicHighlight6,
      t.planBasicHighlight7,
      t.planBasicHighlight8,
    ],
    student: [
      t.planStudentHighlight1,
      t.planStudentHighlight2,
      t.planStudentHighlight3,
      t.planStudentHighlight4,
      t.planStudentHighlight5,
      t.planStudentHighlight6,
    ],
    plus: [
      t.planPlusHighlight1,
      t.planPlusHighlight2,
      t.planPlusHighlight3,
      t.planPlusHighlight4,
      t.planPlusHighlight5,
      t.planPlusHighlight6,
    ],
    advanced: [
      t.planAdvancedHighlight1,
      t.planAdvancedHighlight2,
      t.planAdvancedHighlight3,
      t.planAdvancedHighlight4,
      t.planAdvancedHighlight5,
      t.planAdvancedHighlight6,
      t.planAdvancedHighlight7,
    ],
    premium: [
      t.planPremiumHighlight1,
      t.planPremiumHighlight2,
      t.planPremiumHighlight3,
      t.planPremiumHighlight4,
      t.planPremiumHighlight5,
      t.planPremiumHighlight6,
    ],
  };
  const depthName: Record<PlanTier, string | null> = {
    free: null,
    basic: t.depthEssential,
    student: t.depthStandard,
    plus: t.depthDetailed,
    advanced: t.depthComprehensive,
    premium: t.depthMaximum,
  };
  const depthHint: Record<PlanTier, string | null> = {
    free: null,
    basic: t.depthEssentialHint,
    student: t.depthStandardHint,
    plus: t.depthDetailedHint,
    advanced: t.depthComprehensiveHint,
    premium: t.depthMaximumHint,
  };
  return {
    name: names[tier],
    tagline: taglines[tier],
    includes: includes[tier],
    highlights: highlights[tier],
    depthName: depthName[tier],
    depthHint: depthHint[tier],
  };
}

function statusLine(
  t: Dictionary["billing"],
  status: string,
  cancelAtPeriodEnd: boolean,
  periodEndLabel: string | null
): string {
  if (status === "inactive" || status === "canceled") {
    return t.noActiveSub;
  }
  if (cancelAtPeriodEnd && periodEndLabel) {
    return tf(t.cancelsOn, { date: periodEndLabel });
  }
  if (status === "past_due") {
    return t.pastDue;
  }
  if (periodEndLabel) {
    return tf(t.renewsOnFull, { date: periodEndLabel });
  }
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function BillingClient({
  currentTier,
  status,
  currentPeriodEnd,
  cancelAtPeriodEnd,
  hasCustomer,
  voiceUsedSeconds,
  voiceCapSeconds,
}: {
  currentTier: PlanTier;
  status: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  hasCustomer: boolean;
  voiceUsedSeconds: number;
  voiceCapSeconds: number | null;
}) {
  const t = useT();
  const searchParams = useSearchParams();
  const checkoutStatus = searchParams.get("status");
  const lectureCapHit = searchParams.get("lectureCap") === "1";
  const lectureCapUsed = searchParams.get("used");
  const lectureCapLimit = searchParams.get("cap");

  const [busyTier, setBusyTier] = useState<PlanTier | null>(null);
  const [portalBusy, setPortalBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startCheckout(tier: PlanTier) {
    if (busyTier) return;
    setError(null);
    setBusyTier(tier);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
      };
      if (!res.ok || !data.url) {
        throw new Error(data.error ?? t.billing.checkoutError);
      }
      window.location.href = data.url;
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t.billing.checkoutError
      );
      setBusyTier(null);
    }
  }

  async function openPortal() {
    if (portalBusy) return;
    setError(null);
    setPortalBusy(true);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
      };
      if (!res.ok || !data.url) {
        throw new Error(data.error ?? t.billing.portalError);
      }
      window.location.href = data.url;
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t.billing.portalError
      );
      setPortalBusy(false);
    }
  }

  const periodEndLabel = currentPeriodEnd
    ? new Date(currentPeriodEnd).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;

  const usedMinutes = Math.floor(voiceUsedSeconds / 60);
  const voiceUnlimited = voiceCapSeconds == null;
  const capMinutes = voiceUnlimited ? 0 : Math.round(voiceCapSeconds / 60);
  const usedPct = voiceUnlimited
    ? 100
    : voiceCapSeconds > 0
      ? Math.min(100, Math.round((voiceUsedSeconds / voiceCapSeconds) * 100))
      : 0;
  const capReached =
    !voiceUnlimited && voiceCapSeconds > 0 && voiceUsedSeconds >= voiceCapSeconds;

  const currentPlan = planStrings(t.billing, currentTier);

  return (
    <div>
      <header className="mb-10">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {t.billing.title}
        </h1>
        <p className="mt-3 max-w-2xl text-pretty text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          {t.billing.subtitleLong}
        </p>
      </header>

      {checkoutStatus === "success" ? (
        <Banner tone="success">{t.billing.checkoutSuccessLong}</Banner>
      ) : checkoutStatus === "cancel" ? (
        <Banner tone="muted">{t.billing.checkoutCanceled}</Banner>
      ) : null}

      {lectureCapHit ? (
        <Banner tone="error">
          {tf(t.billing.lectureCapBanner, {
            used: lectureCapUsed || "—",
            cap: lectureCapLimit || "—",
          })}
        </Banner>
      ) : null}

      {error ? <Banner tone="error">{error}</Banner> : null}

      {/* Current plan summary */}
      <div className="mb-12 flex flex-wrap items-center justify-between gap-6 rounded-2xl border border-zinc-200/90 bg-white/95 p-6 sm:p-7 dark:border-zinc-800 dark:bg-zinc-950/90">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
            {t.billing.currentPlan}
          </p>
          <p className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            {currentTier === "free" ? t.billing.noActiveSub : currentPlan.name}
            {voiceUnlimited ? (
              <span className="ml-2 text-sm font-normal text-zinc-500">
                · {t.billing.voiceHoursUnlimited}
              </span>
            ) : currentTier !== "free" ? (
              <span className="ml-2 text-sm font-normal text-zinc-500">
                ·{" "}
                {tf(t.billing.voiceHoursMonth, {
                  hours: String(voiceHours(currentTier)),
                })}
              </span>
            ) : null}
          </p>
          <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400">
            {statusLine(
              t.billing,
              status,
              cancelAtPeriodEnd,
              periodEndLabel
            )}
          </p>
          <div className="mt-5 w-full max-w-xs">
            <div className="flex w-full items-center justify-between gap-3 text-[11px] text-zinc-500 dark:text-zinc-400">
              <span className="shrink-0">{t.billing.voiceThisPeriod}</span>
              <span className="shrink-0 tabular-nums">
                {voiceUnlimited
                  ? tf(t.billing.voiceUsedUnlimited, { used: usedMinutes })
                  : `${usedMinutes} / ${capMinutes} min`}
              </span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
              <div
                className={`h-full rounded-full ${
                  capReached ? "bg-amber-500" : "bg-brand"
                }`}
                style={{ width: `${usedPct}%` }}
              />
            </div>
            {capReached ? (
              <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">
                {t.billing.voiceLimitReached}
              </p>
            ) : null}
          </div>
        </div>
        {hasCustomer ? (
          <button
            type="button"
            onClick={openPortal}
            disabled={portalBusy}
            className="inline-flex items-center rounded-full border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:border-zinc-400 hover:text-zinc-900 disabled:opacity-60 dark:border-zinc-600 dark:text-zinc-200 dark:hover:border-zinc-500"
          >
            {portalBusy ? t.billing.opening : t.billing.manageBilling}
          </button>
        ) : null}
      </div>

      {/* Plan cards — wrap 2 then 3 rather than five crushed columns */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 md:gap-7 xl:grid-cols-3">
        {CHECKOUT_PLAN_ORDER.map((tier) => {
          const plan = planStrings(t.billing, tier);
          const charged = salePriceMonthly(tier);
          const isCurrent = tier === currentTier;
          const wasPrice = compareAtPriceMonthly(tier);
          const showSale =
            isPaidTier(tier) &&
            charged > 0 &&
            wasPrice != null &&
            wasPrice > charged;
          const salePercent = showSale ? salePercentForTier(tier) : 0;
          const isBest = tier === "advanced";
          const isTrialCard =
            isStudentTrialActive() && tier === "student" && !isCurrent;
          return (
            <div
              key={tier}
              className={`relative flex flex-col rounded-2xl border px-6 pb-6 pt-7 ${
                isBest
                  ? "plan-card-best"
                  : isTrialCard
                    ? "plan-card-trial"
                    : isCurrent
                      ? "border-brand bg-brand/[0.04] dark:border-brand-soft dark:bg-brand-soft/[0.06]"
                      : "border-zinc-200/90 bg-white/95 dark:border-zinc-800 dark:bg-zinc-950/90"
              }`}
            >
              {isBest ? (
                <span className="plan-best-badge absolute -top-2.5 left-1/2 z-10 -translate-x-1/2 rounded-full px-3 py-0.5 text-[10px] font-bold tracking-[0.14em]">
                  {t.billing.bestBadge}
                </span>
              ) : isTrialCard ? (
                <span className="plan-trial-badge absolute -top-2.5 left-1/2 z-10 -translate-x-1/2 rounded-full px-3 py-0.5 text-[10px] font-bold tracking-[0.14em]">
                  {t.billing.limitedTimeBadge}
                </span>
              ) : null}
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                  {plan.name}
                </h2>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                  {showSale ? (
                    <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300">
                      {tf(t.billing.saleBadge, { percent: String(salePercent) })}
                    </span>
                  ) : null}
                  {isCurrent ? (
                    <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-semibold text-brand dark:bg-brand-soft/15 dark:text-brand-soft">
                      {t.billing.current}
                    </span>
                  ) : null}
                </div>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
                {plan.tagline}
              </p>

              <div className="mt-6">
                {isTrialCard ? (
                  <p className="text-sm font-semibold tracking-tight text-emerald-800 dark:text-emerald-300">
                    {t.billing.studentTrialHeadline}
                  </p>
                ) : null}
                <p className={isTrialCard ? "mt-2" : undefined}>
                  {isTrialCard ? (
                    <span className="mr-2 text-xs font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                      {t.billing.studentTrialThen}
                    </span>
                  ) : null}
                  {showSale ? (
                    <>
                      <span className="mr-2 text-lg font-medium text-zinc-400 line-through dark:text-zinc-500">
                        ${formatUsdAmount(wasPrice)}
                      </span>
                      <span className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
                        ${formatUsdAmount(charged)}
                      </span>
                    </>
                  ) : (
                    <span className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
                      ${formatUsdAmount(charged)}
                    </span>
                  )}
                  <span className="text-sm text-zinc-500 dark:text-zinc-400">
                    {" "}
                    {t.billing.perMonthLabel}
                  </span>
                </p>
                {showSale ? (
                  <p className="mt-2 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                    {t.billing.salePriceNote}
                  </p>
                ) : null}
                {isTrialCard ? (
                  <p className="mt-2 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                    {t.billing.studentTrialNote}
                  </p>
                ) : null}
              </div>

              {plan.depthName ? (
                <p
                  className="mt-6 truncate text-xs text-zinc-500 dark:text-zinc-400"
                  title={plan.depthHint ?? undefined}
                >
                  <span className="font-medium text-zinc-600 dark:text-zinc-300">
                    {t.billing.depthLabel}
                  </span>
                  <span className="mx-1.5 text-zinc-300 dark:text-zinc-600">
                    ·
                  </span>
                  <span>{plan.depthName}</span>
                </p>
              ) : null}

              {plan.includes ? (
                <p className="mt-5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                  {plan.includes}
                </p>
              ) : (
                <div className="mt-5" />
              )}
              <ul className="mt-3 flex-1 space-y-2.5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
                {plan.highlights.map((h) => (
                  <li key={h} className="flex items-start gap-2.5">
                    <svg
                      className="mt-0.5 h-4 w-4 shrink-0 text-brand dark:text-brand-soft"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                    <span>{h}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-8">{renderCta(tier, isCurrent, isTrialCard)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );

  function renderCta(tier: PlanTier, isCurrent: boolean, isTrialCard: boolean) {
    if (isCurrent) {
      return (
        <button
          type="button"
          disabled
          className="w-full cursor-default rounded-full bg-zinc-100 px-4 py-2.5 text-sm font-semibold text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
        >
          {tier === "free" ? t.billing.yourPlan : t.billing.currentPlan}
        </button>
      );
    }
    if (!isPaidTier(tier)) {
      // Downgrade to free is handled by canceling in the portal.
      return hasCustomer ? (
        <button
          type="button"
          onClick={openPortal}
          disabled={portalBusy}
          className="w-full rounded-full border border-zinc-300 px-4 py-2.5 text-sm font-semibold text-zinc-700 transition hover:border-zinc-400 disabled:opacity-60 dark:border-zinc-600 dark:text-zinc-200"
        >
          {t.billing.cancelInPortal}
        </button>
      ) : (
        <button
          type="button"
          disabled
          className="w-full cursor-default rounded-full bg-zinc-100 px-4 py-2.5 text-sm font-semibold text-zinc-400 dark:bg-zinc-800"
        >
          {t.billing.included}
        </button>
      );
    }
    return (
      <button
        type="button"
        onClick={() => startCheckout(tier)}
        disabled={busyTier !== null}
        className="w-full rounded-full bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-hover disabled:opacity-60"
      >
        {busyTier === tier
          ? t.billing.redirecting
          : isTrialCard
            ? t.billing.startStudentTrial
            : isPaidTier(currentTier)
              ? t.billing.switchPlan
              : t.billing.upgrade}
      </button>
    );
  }
}

function Banner({
  tone,
  children,
}: {
  tone: "success" | "error" | "muted";
  children: React.ReactNode;
}) {
  const cls =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
      : tone === "error"
        ? "border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300"
        : "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300";
  return (
    <div className={`mb-6 rounded-xl border px-4 py-3 text-sm ${cls}`}>
      {children}
    </div>
  );
}
