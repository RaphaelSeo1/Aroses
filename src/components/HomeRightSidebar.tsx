"use client";

import Link from "next/link";
import { isBillingUiEnabled } from "@/lib/billing/feature-flag";
import { PLANS, type PlanTier } from "@/lib/billing/plans";
import type { PlanUsageSummary } from "@/lib/billing/plan-usage-types";
import { useT } from "@/lib/i18n/LocaleProvider";
import { tf } from "@/lib/i18n/format";

function weekdayLabelsLast7(): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    out.push({ key: d.toISOString().slice(0, 10), label: names[d.getDay()] });
  }
  return out;
}

function streakFromBuckets(last7: number[]): number {
  let s = 0;
  for (let i = last7.length - 1; i >= 0; i--) {
    if (last7[i] > 0) s += 1;
    else break;
  }
  return s;
}

function usagePct(used: number, cap: number | null): number {
  if (cap == null || cap <= 0) return 0;
  return Math.min(100, Math.round((used / cap) * 100));
}

/** Heat of a limited meter: cooler when empty, hotter near the cap. */
function usageTone(pct: number): "ok" | "warn" | "hot" {
  if (pct >= 90) return "hot";
  if (pct >= 70) return "warn";
  return "ok";
}

function planDisplayName(
  billing: {
    planFree: string;
    planStudent: string;
    planAdvanced: string;
    planPremium: string;
  },
  tier: PlanTier
): string {
  if (tier === "free") return billing.planFree;
  if (tier === "student") return billing.planStudent;
  if (tier === "advanced") return billing.planAdvanced;
  return billing.planPremium;
}

function UsageMeter({
  label,
  valueLabel,
  pct,
  unlimited = false,
}: {
  label: string;
  valueLabel: string;
  pct: number;
  /** Unlimited caps stay full + glowing green. */
  unlimited?: boolean;
}) {
  const fillPct = unlimited ? 100 : Math.max(0, Math.min(100, pct));
  const tone = unlimited ? "unlimited" : usageTone(fillPct);

  const fillToneClass =
    tone === "unlimited"
      ? "plan-usage-fill--unlimited bg-gradient-to-r from-emerald-300 via-emerald-400 to-emerald-600 shadow-[0_0_10px_rgba(52,211,153,0.85),0_0_22px_rgba(16,185,129,0.55)]"
      : tone === "hot"
        ? "bg-gradient-to-r from-rose-400 via-rose-500 to-brand shadow-[0_0_10px_rgba(244,63,94,0.7),0_0_20px_rgba(225,29,72,0.45)]"
        : tone === "warn"
          ? "bg-gradient-to-r from-amber-300 via-amber-400 to-amber-500 shadow-[0_0_10px_rgba(251,191,36,0.7),0_0_18px_rgba(245,158,11,0.4)]"
          : "bg-gradient-to-r from-emerald-300 via-emerald-400 to-emerald-600 shadow-[0_0_8px_rgba(52,211,153,0.65),0_0_16px_rgba(16,185,129,0.35)]";

  return (
    <div>
      <div className="flex items-center justify-between gap-3 text-[11px]">
        <span className="font-medium text-zinc-600 dark:text-zinc-300">
          {label}
        </span>
        <span className="shrink-0 tabular-nums text-zinc-500 dark:text-zinc-400">
          {valueLabel}
        </span>
      </div>
      <div className="mt-2 h-2.5 w-full overflow-visible rounded-full bg-zinc-200/95 ring-1 ring-inset ring-zinc-300/70 dark:bg-zinc-800 dark:ring-zinc-600/70">
        <div
          className={`h-full min-h-2.5 rounded-full transition-[width] duration-500 ease-out ${
            fillPct > 0 ? fillToneClass : "bg-transparent"
          }`}
          style={{ width: `${Math.max(fillPct, fillPct > 0 ? fillPct : 0)}%` }}
          aria-hidden
        />
      </div>
    </div>
  );
}

export function HomeRightSidebar({
  activityBuckets14,
  reviewDueTotal = 0,
  resumeTitle = null,
  resumeHref = null,
  planUsage = null,
}: {
  activityBuckets14: number[];
  reviewDueTotal?: number;
  resumeTitle?: string | null;
  resumeHref?: string | null;
  planUsage?: PlanUsageSummary | null;
}) {
  const t = useT();
  const days = weekdayLabelsLast7();
  const last7 = activityBuckets14.slice(-7);
  const streak = streakFromBuckets(last7);
  const hasAnyActiveDay = last7.some((n) => n > 0);
  const streakLabel =
    streak === 1
      ? tf(t.dashboard.streakDaysOne, { count: streak })
      : tf(t.dashboard.streakDaysMany, { count: streak });

  const hasUpNext = reviewDueTotal > 0 || Boolean(resumeTitle && resumeHref);
  const billingEnabled = isBillingUiEnabled();
  const showPlanUsage = Boolean(planUsage) && billingEnabled;

  const voiceUsedMin = planUsage
    ? Math.floor(planUsage.voiceUsedSeconds / 60)
    : 0;
  const voiceCapMin = planUsage
    ? Math.round(planUsage.voiceCapSeconds / 60)
    : 0;
  const coursesPct = planUsage
    ? usagePct(planUsage.coursesUsed, planUsage.coursesCap)
    : 0;
  const voicePct = planUsage
    ? usagePct(planUsage.voiceUsedSeconds, planUsage.voiceCapSeconds)
    : 0;
  const recordingsPct = planUsage
    ? usagePct(planUsage.recordingsUsed, planUsage.recordingsCap)
    : 0;

  return (
    <aside className="space-y-4 lg:sticky lg:top-[5.5rem]">
      {showPlanUsage && planUsage ? (
        <section className="group relative overflow-hidden rounded-3xl border border-zinc-200/90 bg-gradient-to-br from-sky-50/80 via-white to-white p-5 shadow-sm ring-1 ring-sky-100/80 backdrop-blur-md dark:border-zinc-800 dark:from-sky-950/40 dark:via-zinc-950 dark:to-zinc-950 dark:ring-sky-900/40">
          <div
            className="pointer-events-none absolute -right-12 -top-12 h-36 w-36 rounded-full bg-sky-200/60 blur-2xl dark:bg-sky-500/20"
            aria-hidden
          />
          <div
            className="pointer-events-none absolute -bottom-16 -left-10 h-28 w-28 rounded-full bg-cyan-200/40 blur-2xl dark:bg-sky-400/10"
            aria-hidden
          />
          <div className="relative flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                {t.dashboard.planUsageTitle}
              </p>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                {planDisplayName(t.billing, planUsage.tier)}
                {planUsage.tier !== "free" ? (
                  <span className="text-zinc-400 dark:text-zinc-500">
                    {" "}
                    ·{" "}
                    {tf(t.billing.voiceHoursMonth, {
                      hours: PLANS[planUsage.tier].voiceHours,
                    })}
                  </span>
                ) : null}
              </p>
            </div>
            {planUsage.tier !== "premium" ? (
              <Link
                href="/dashboard/billing"
                className="shrink-0 rounded-full bg-brand px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-brand-hover"
              >
                {t.dashboard.planUsageUpgrade}
              </Link>
            ) : (
              <Link
                href="/dashboard/billing"
                className="shrink-0 rounded-full border border-zinc-200 px-3 py-1.5 text-[11px] font-semibold text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
              >
                {t.dashboard.planUsageViewPlans}
              </Link>
            )}
          </div>

          <div className="relative mt-4 space-y-3.5">
            <UsageMeter
              label={t.dashboard.planUsageCourses}
              valueLabel={
                planUsage.coursesCap == null
                  ? tf(t.dashboard.planUsageUnlimited, {
                      used: planUsage.coursesUsed,
                    })
                  : tf(t.dashboard.planUsageOf, {
                      used: planUsage.coursesUsed,
                      cap: planUsage.coursesCap,
                    })
              }
              pct={coursesPct}
              unlimited={planUsage.coursesCap == null}
            />
            <UsageMeter
              label={t.dashboard.planUsageVoice}
              valueLabel={tf(t.dashboard.planUsageMinutes, {
                used: voiceUsedMin,
                cap: voiceCapMin,
              })}
              pct={voicePct}
            />
            <UsageMeter
              label={t.dashboard.planUsageRecordings}
              valueLabel={tf(t.dashboard.planUsageOf, {
                used: planUsage.recordingsUsed,
                cap: planUsage.recordingsCap,
              })}
              pct={recordingsPct}
            />
          </div>
        </section>
      ) : null}

      <section className="overflow-hidden rounded-3xl border border-zinc-200/90 bg-white/95 p-5 shadow-lg shadow-zinc-900/[0.05] ring-1 ring-white/50 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-950/80 dark:ring-zinc-700/30">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              {t.dashboard.studyStreakTitle}
            </p>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              {t.dashboard.studyStreakHint}
            </p>
          </div>
          {streak > 0 ? (
            <span className="rounded-full bg-brand-blush/80 px-2.5 py-1 text-xs font-semibold text-brand-ink dark:bg-[#1e1616]/70 dark:text-brand-soft">
              {streakLabel}
            </span>
          ) : null}
        </div>

        {streak === 0 ? (
          <div className="mt-5 rounded-2xl border border-dashed border-zinc-200 bg-zinc-50/80 px-4 py-4 dark:border-zinc-700 dark:bg-zinc-900/40">
            <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100">
              {t.dashboard.streakStartInvite}
            </p>
            {resumeHref ? (
              <Link
                href={resumeHref}
                className="mt-2 inline-flex text-xs font-semibold text-brand hover:underline dark:text-brand-soft"
              >
                {t.dashboard.streakStartLink} →
              </Link>
            ) : (
              <Link
                href="/library/continue"
                className="mt-2 inline-flex text-xs font-semibold text-brand hover:underline dark:text-brand-soft"
              >
                {t.dashboard.streakStartLink} →
              </Link>
            )}
          </div>
        ) : hasAnyActiveDay ? (
          <div className="mt-5 grid grid-cols-7 gap-2">
            {days.map((d, i) => {
              const n = last7[i] ?? 0;
              const active = n > 0;
              const today = i === 6;
              return (
                <div key={d.key} className="text-center">
                  <div
                    className={[
                      "mx-auto h-9 w-9 rounded-xl border",
                      active
                        ? "border-brand/40 bg-brand shadow-[0_0_18px_rgba(220,38,38,0.25)]"
                        : today
                          ? "border-brand/40 bg-white dark:bg-zinc-950"
                          : "border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900/40",
                    ].join(" ")}
                    title={`${d.label}: ${n} attempt${n === 1 ? "" : "s"}`}
                  />
                  <p className="mt-1 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                    {d.label}
                  </p>
                </div>
              );
            })}
          </div>
        ) : null}
      </section>

      {hasUpNext ? (
        <section className="overflow-hidden rounded-3xl border border-zinc-200/90 bg-white/95 p-5 shadow-lg shadow-zinc-900/[0.05] ring-1 ring-white/50 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-950/80 dark:ring-zinc-700/30">
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            {t.dashboard.upNextTitle}
          </p>
          <ul className="mt-3 space-y-2.5">
            {reviewDueTotal > 0 ? (
              <li>
                <Link
                  href="/dashboard/review"
                  className="block rounded-xl border border-brand-border/50 bg-brand-blush/40 px-3 py-2.5 text-xs font-medium text-brand-ink transition hover:bg-brand-blush/70 dark:border-brand-border/30 dark:bg-brand-blush/10 dark:text-brand-soft dark:hover:bg-brand-blush/20"
                >
                  {reviewDueTotal === 1
                    ? t.dashboard.upNextReviewsOne
                    : tf(t.dashboard.upNextReviews, {
                        count: reviewDueTotal,
                      })}
                </Link>
              </li>
            ) : null}
            {resumeTitle && resumeHref ? (
              <li>
                <Link
                  href={resumeHref}
                  className="block rounded-xl border border-zinc-200 bg-zinc-50/80 px-3 py-2.5 text-xs font-medium text-zinc-800 transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-100 dark:hover:bg-zinc-900"
                >
                  {tf(t.dashboard.upNextModule, { title: resumeTitle })}
                </Link>
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}
    </aside>
  );
}
