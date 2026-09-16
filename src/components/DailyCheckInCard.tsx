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
      className="relative overflow-hidden rounded-3xl border border-zinc-200/90 bg-gradient-to-br from-rose-50/90 via-white to-white p-5 shadow-lg shadow-zinc-900/[0.05] ring-1 ring-white/50 backdrop-blur-md dark:border-zinc-800 dark:from-rose-950/35 dark:via-zinc-950 dark:to-zinc-950 dark:ring-zinc-700/30"
    >
      <div
        className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-brand/15 blur-2xl dark:bg-brand/20"
        aria-hidden
      />
      <div className="relative flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            {t.checkin.title}
          </p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            {t.checkin.hint}
          </p>
        </div>
        {streak > 0 ? (
          <span className="shrink-0 rounded-full bg-brand-blush/80 px-2.5 py-1 text-xs font-semibold text-brand-ink dark:bg-[#1e1616]/70 dark:text-brand-soft">
            {streak === 1
              ? tf(t.checkin.streakOne, { count: streak })
              : tf(t.checkin.streakMany, { count: streak })}
          </span>
        ) : null}
      </div>

      <div className="relative mt-4">
        <div className="flex items-center justify-between gap-3 text-[11px]">
          <span className="font-medium text-zinc-600 dark:text-zinc-300">
            {plusUnlocked
              ? t.checkin.progressDone
              : tf(t.checkin.progress, { current: progress, goal })}
          </span>
          <span className="tabular-nums text-zinc-500 dark:text-zinc-400">
            {progress}/{goal}
          </span>
        </div>
        <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-zinc-200/95 ring-1 ring-inset ring-zinc-300/70 dark:bg-zinc-800 dark:ring-zinc-600/70">
          <div
            className="h-full rounded-full bg-gradient-to-r from-rose-400 via-brand to-rose-600 shadow-[0_0_10px_rgba(225,29,72,0.45)] transition-[width] duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
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
          {tf(t.checkin.celebrationBody, { streak })}
          <span className="mt-1 block text-xs font-normal text-zinc-500 dark:text-zinc-400">
            {t.checkin.comeBackTomorrow}
          </span>
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
