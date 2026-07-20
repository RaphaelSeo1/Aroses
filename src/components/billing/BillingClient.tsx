"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  PLANS,
  PLAN_ORDER,
  isPaidTier,
  type PlanTier,
} from "@/lib/billing/plans";
import { useT } from "@/lib/i18n/LocaleProvider";
import { tf } from "@/lib/i18n/format";
import type { Dictionary } from "@/locales";

function planStrings(t: Dictionary["billing"], tier: PlanTier) {
  const names: Record<PlanTier, string> = {
    free: t.planFree,
    student: t.planStudent,
    premium: t.planPremium,
  };
  const taglines: Record<PlanTier, string> = {
    free: t.planFreeTag,
    student: t.planStudentTag,
    premium: t.planPremiumTag,
  };
  const highlights: Record<PlanTier, string[]> = {
    free: [t.planFreeHighlight1, t.planFreeHighlight2, t.planFreeHighlight3],
    student: [
      t.planStudentHighlight1,
      t.planStudentHighlight2,
      t.planStudentHighlight3,
    ],
    premium: [
      t.planPremiumHighlight1,
      t.planPremiumHighlight2,
      t.planPremiumHighlight3,
    ],
  };
  return {
    name: names[tier],
    tagline: taglines[tier],
    highlights: highlights[tier],
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
  voiceCapSeconds: number;
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
  const capMinutes = Math.round(voiceCapSeconds / 60);
  const usedPct =
    voiceCapSeconds > 0
      ? Math.min(100, Math.round((voiceUsedSeconds / voiceCapSeconds) * 100))
      : 0;
  const capReached = voiceCapSeconds > 0 && voiceUsedSeconds >= voiceCapSeconds;

  const currentPlan = planStrings(t.billing, currentTier);

  return (
    <div>
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {t.billing.title}
        </h1>
        <p className="mt-2 max-w-2xl text-pretty text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
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
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-zinc-200/90 bg-white/95 p-5 dark:border-zinc-800 dark:bg-zinc-950/90">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
            {t.billing.currentPlan}
          </p>
          <p className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            {currentPlan.name}
            {currentTier !== "free" ? (
              <span className="ml-2 text-sm font-normal text-zinc-500">
                ·{" "}
                {tf(t.billing.voiceHoursMonth, {
                  hours: PLANS[currentTier].voiceHours,
                })}
              </span>
            ) : null}
          </p>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            {statusLine(
              t.billing,
              status,
              cancelAtPeriodEnd,
              periodEndLabel
            )}
          </p>
          <div className="mt-3 w-full max-w-xs">
            <div className="flex w-full items-center justify-between gap-3 text-[11px] text-zinc-500 dark:text-zinc-400">
              <span className="shrink-0">{t.billing.voiceThisPeriod}</span>
              <span className="shrink-0 tabular-nums">
                {usedMinutes} / {capMinutes} min
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

      {/* Plan cards */}
      <div className="grid gap-4 md:grid-cols-3">
        {PLAN_ORDER.map((tier) => {
          const plan = planStrings(t.billing, tier);
          const price = PLANS[tier].priceMonthly;
          const isCurrent = tier === currentTier;
          return (
            <div
              key={tier}
              className={`flex flex-col rounded-2xl border p-5 ${
                isCurrent
                  ? "border-brand bg-brand/[0.04] dark:border-brand-soft dark:bg-brand-soft/[0.06]"
                  : "border-zinc-200/90 bg-white/95 dark:border-zinc-800 dark:bg-zinc-950/90"
              }`}
            >
              <div className="flex items-baseline justify-between">
                <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                  {plan.name}
                </h2>
                {isCurrent ? (
                  <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-semibold text-brand dark:bg-brand-soft/15 dark:text-brand-soft">
                    {t.billing.current}
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                {plan.tagline}
              </p>
              <p className="mt-3">
                <span className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
                  ${price}
                </span>
                <span className="text-sm text-zinc-500 dark:text-zinc-400">
                  {" "}
                  {t.billing.perMonthLabel}
                </span>
              </p>
              <ul className="mt-4 flex-1 space-y-2 text-sm text-zinc-600 dark:text-zinc-300">
                {plan.highlights.map((h) => (
                  <li key={h} className="flex items-start gap-2">
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
              <div className="mt-5">{renderCta(tier, isCurrent)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );

  function renderCta(tier: PlanTier, isCurrent: boolean) {
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
