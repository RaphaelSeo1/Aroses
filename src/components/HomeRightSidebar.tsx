"use client";

import Link from "next/link";
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

export function HomeRightSidebar({
  activityBuckets14,
  reviewDueTotal = 0,
  resumeTitle = null,
  resumeHref = null,
}: {
  activityBuckets14: number[];
  reviewDueTotal?: number;
  resumeTitle?: string | null;
  resumeHref?: string | null;
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

  return (
    <aside className="space-y-4 lg:sticky lg:top-[5.5rem]">
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
