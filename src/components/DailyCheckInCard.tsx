"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/LocaleProvider";
import { tf } from "@/lib/i18n/format";
import {
  fireCheckInConfetti,
  useDailyCheckIn,
} from "@/lib/checkin/use-daily-checkin";

function RoseGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 20c-2.2-2.4-6-5.2-6-9a6 6 0 0 1 12 0c0 3.8-3.8 6.6-6 9Z" />
      <path d="M12 11c.8-1.6 2.4-2.4 4-2.4" />
      <path d="M12 11c-.8-1.2-2-2-3.6-2.2" />
    </svg>
  );
}

const MILESTONES = [10, 20, 30] as const;

export function DailyCheckInCard() {
  const t = useT();
  const { status, busy, error, checkIn } = useDailyCheckIn();
  const [celebrate, setCelebrate] = useState<
    "plain" | "plus" | "skipped" | null
  >(null);

  const streak = status?.currentStreak ?? 0;
  const goal = status?.goal ?? 30;
  const progress = status?.goalProgress ?? 0;
  const checkedIn = Boolean(status?.checkedInToday);
  const pct = Math.min(100, Math.round((progress / goal) * 100));
  const plusUnlocked = Boolean(
    status?.plusGrants || status?.plusGrantPeriodEnd
  );
  const showHeroStreak = streak > 0;
  const remaining = Math.max(0, goal - progress);

  const onCheckIn = async () => {
    const result = await checkIn();
    if (!result?.justCheckedIn && !result?.plusGranted) return;
    if (result.plusGranted) {
      setCelebrate("plus");
      void fireCheckInConfetti(true);
    } else if (result.plusGrantSkippedHigherPlan && result.currentStreak >= 30) {
      setCelebrate("skipped");
      void fireCheckInConfetti(true);
    } else {
      setCelebrate("plain");
      void fireCheckInConfetti(false);
    }
  };

  const plusUntil = status?.plusGrantPeriodEnd
    ? new Date(status.plusGrantPeriodEnd).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })
    : "";

  return (
    <section
      id="daily-check-in"
      className="relative overflow-hidden rounded-3xl border border-zinc-200/90 bg-gradient-to-br from-rose-50/95 via-white to-white p-5 shadow-lg shadow-zinc-900/[0.05] ring-1 ring-white/50 backdrop-blur-md dark:border-zinc-800 dark:from-rose-950/40 dark:via-zinc-950 dark:to-zinc-950 dark:ring-zinc-700/30"
    >
      <div
        className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full bg-brand/20 blur-3xl dark:bg-brand/25"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -bottom-14 -left-10 h-28 w-28 rounded-full bg-rose-200/40 blur-3xl dark:bg-rose-900/25"
        aria-hidden
      />

      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            {t.checkin.title}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
            {t.checkin.hint}
          </p>
        </div>
        {checkedIn ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-brand-border/70 bg-brand-blush/90 px-2.5 py-1 text-[11px] font-semibold text-brand-ink dark:border-brand-border/30 dark:bg-[#1e1616]/80 dark:text-brand-soft">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-soft-pulse rounded-full bg-brand opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand" />
            </span>
            {t.checkin.checkedIn}
          </span>
        ) : null}
      </div>

      {showHeroStreak ? (
        <div className="relative mt-4 flex items-end gap-2.5">
          <p
            className={[
              "text-[2.75rem] font-semibold leading-none tracking-tight tabular-nums text-brand dark:text-brand-soft",
              celebrate === "plain" || celebrate === "plus"
                ? "origin-bottom-left transition-transform duration-500 ease-out motion-safe:scale-105"
                : "",
            ].join(" ")}
            aria-label={
              streak === 1
                ? tf(t.checkin.streakOne, { count: streak })
                : tf(t.checkin.streakMany, { count: streak })
            }
          >
            {streak}
          </p>
          <div className="mb-1.5 min-w-0">
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              {streak === 1
                ? t.checkin.streakLabelOne
                : t.checkin.streakLabelMany}
            </p>
            <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
              {plusUnlocked
                ? t.checkin.progressDone
                : tf(t.checkin.daysToPlus, { remaining })}
            </p>
          </div>
        </div>
      ) : null}

      <div className="relative mt-4">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            {plusUnlocked ? t.checkin.progressDoneShort : t.checkin.progressLabel}
          </span>
          <span className="text-xs font-semibold tabular-nums text-zinc-800 dark:text-zinc-100">
            {tf(t.checkin.progressCount, { current: progress, goal })}
          </span>
        </div>

        <div className="relative mt-2.5">
          <div className="h-3.5 w-full overflow-hidden rounded-full bg-zinc-200/90 ring-1 ring-inset ring-zinc-300/60 dark:bg-zinc-800 dark:ring-zinc-600/60">
            <div
              className="relative h-full rounded-full bg-gradient-to-r from-rose-400 via-brand to-rose-600 transition-[width] duration-500 ease-out"
              style={{
                width: `${pct}%`,
                minWidth: progress > 0 && pct < 8 ? "0.75rem" : undefined,
              }}
            >
              <div
                className="absolute inset-y-0 right-0 w-2 rounded-full bg-white/35"
                aria-hidden
              />
            </div>
          </div>
          {!plusUnlocked ? (
            <div
              className="pointer-events-none absolute inset-x-0 top-0 h-3.5"
              aria-hidden
            >
              {MILESTONES.filter((m) => m < goal).map((m) => (
                <span
                  key={m}
                  className="absolute top-0.5 bottom-0.5 w-px bg-white/80 dark:bg-zinc-950/55"
                  style={{ left: `${(m / goal) * 100}%` }}
                />
              ))}
            </div>
          ) : null}
        </div>

        {!plusUnlocked ? (
          <div className="relative mt-1.5 h-3.5 text-[10px] tabular-nums text-zinc-400 dark:text-zinc-500">
            <span className="absolute left-0">0</span>
            {MILESTONES.filter((m) => m <= goal).map((m) => (
              <span
                key={m}
                className={[
                  "absolute",
                  m === goal ? "right-0" : "-translate-x-1/2",
                  progress >= m
                    ? "font-medium text-brand dark:text-brand-soft"
                    : "",
                ].join(" ")}
                style={m === goal ? undefined : { left: `${(m / goal) * 100}%` }}
              >
                {m}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {celebrate === "plus" ? (
        <p className="relative mt-4 rounded-2xl bg-brand px-4 py-3 text-sm font-medium text-white shadow-md shadow-red-600/20">
          {t.checkin.celebrationPlusTitle}
          <span className="mt-1 block text-xs font-normal text-white/90">
            {tf(t.checkin.celebrationPlusBody, { date: plusUntil || "—" })}
          </span>
        </p>
      ) : celebrate === "skipped" ? (
        <p className="relative mt-4 rounded-2xl border border-brand-border/50 bg-brand-blush/50 px-4 py-3 text-sm font-medium text-brand-ink dark:border-brand-border/30 dark:bg-brand-blush/10 dark:text-brand-soft">
          {t.checkin.celebrationPlusSkipped}
        </p>
      ) : celebrate === "plain" || checkedIn ? (
        <p className="relative mt-4 text-sm font-medium text-zinc-800 dark:text-zinc-100">
          {t.checkin.celebrationBody}
        </p>
      ) : null}

      {!checkedIn ? (
        <button
          type="button"
          onClick={() => void onCheckIn()}
          disabled={busy}
          className="relative mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-red-600/20 transition hover:bg-brand-hover disabled:opacity-60"
        >
          <RoseGlyph className="h-4 w-4" />
          {busy ? t.checkin.checking : t.checkin.cta}
        </button>
      ) : (
        <p className="relative mt-3 text-[11px] text-zinc-500 dark:text-zinc-400">
          {t.checkin.timezoneNote}
        </p>
      )}

      {error ? (
        <p className="relative mt-2 text-xs text-brand">{t.checkin.errorGeneric}</p>
      ) : null}
    </section>
  );
}
