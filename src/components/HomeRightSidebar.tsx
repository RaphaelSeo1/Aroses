"use client";

import Link from "next/link";
import { buildResumeCourseHref } from "@/lib/dashboard/resume-course-href";
import type { CourseMode } from "@/types/mentored";

type RecentPractice = {
  courseId: string;
  materialId: string;
  title: string;
  answeredAt: string;
  correctLast10: number;
  totalLast10: number;
  modulesCompleted: number;
  modulesTotal: number;
  isExploreLearner: boolean;
  /**
   * Drives the "Jump back in" target so the student returns to the
   * experience they were last using — Mentored Learning or Free
   * Exploration — at the lesson they left off on.
   */
  lastUsedMode: CourseMode;
  resumeModuleId: number | null;
};

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

function formatRelativeTime(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const diffMs = Date.now() - t;
  const min = Math.round(diffMs / 60_000);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return hr === 1 ? "1 hour ago" : `${hr} hours ago`;
  const days = Math.round(hr / 24);
  return days === 1 ? "Yesterday" : `${days} days ago`;
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
  recentPractice,
}: {
  activityBuckets14: number[];
  recentPractice: RecentPractice[];
}) {
  const days = weekdayLabelsLast7();
  const last7 = activityBuckets14.slice(-7);
  const streak = streakFromBuckets(last7);
  const suggested = (() => {
    const unfinished = recentPractice.filter(
      (r) => r.modulesTotal > 0 && r.modulesCompleted < r.modulesTotal
    );
    // If everything is finished (or has no module payload yet), fall back to recency.
    return (unfinished.length > 0 ? unfinished : recentPractice).slice(0, 3);
  })();

  return (
    <aside className="space-y-5 lg:sticky lg:top-[5.5rem]">
      <section className="overflow-hidden rounded-3xl border border-zinc-200/90 bg-white/95 p-5 shadow-lg shadow-zinc-900/[0.05] ring-1 ring-white/50 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-950/80 dark:ring-zinc-700/30">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              Study streak this week
            </p>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Keep a small daily practice habit.
            </p>
          </div>
          <span className="rounded-full bg-brand-blush/80 px-2.5 py-1 text-xs font-semibold text-brand-ink dark:bg-[#1e1616]/70 dark:text-brand-soft">
            {streak} day{streak === 1 ? "" : "s"}
          </span>
        </div>

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

        <p className="mt-5 text-sm font-semibold text-brand-ink dark:text-brand-soft">
          {streak}
          <span className="ml-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">
            day streak — keep it going!
          </span>
        </p>
      </section>

      <section className="overflow-hidden rounded-3xl border border-zinc-200/90 bg-white/95 p-5 shadow-lg shadow-zinc-900/[0.05] ring-1 ring-white/50 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-950/80 dark:ring-zinc-700/30">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              Suggested next
            </p>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Quick jumps back into what you started.
            </p>
          </div>
          <Link
            href="/dashboard/profile?tab=progress"
            className="text-xs font-semibold text-brand underline-offset-2 hover:underline dark:text-brand-soft"
          >
            View progress
          </Link>
        </div>

        {suggested.length === 0 ? (
          <p className="mt-5 text-sm text-zinc-600 dark:text-zinc-400">
            No practice yet. Open a course and try a quiz.
          </p>
        ) : (
          <ul className="mt-5 space-y-3">
            {suggested.map((r) => {
              const score =
                r.totalLast10 > 0
                  ? `${r.correctLast10}/${r.totalLast10}`
                  : "—";
              const progress =
                r.modulesTotal > 0 ? `${r.modulesCompleted}/${r.modulesTotal}` : null;
              // Mirror the Continue Studying card — route to the
              // experience the student last used for THIS course rather
              // than always sending them to the reading view.
              const href = buildResumeCourseHref({
                courseId: r.courseId,
                lastUsedMode: r.lastUsedMode,
                isExploreLearner: r.isExploreLearner,
                materialId: r.materialId,
                moduleId: r.resumeModuleId,
              });
              return (
                <li
                  key={r.courseId}
                  className="flex items-center justify-between gap-4 rounded-2xl border border-zinc-100 bg-zinc-50/70 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/30"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                      {r.title}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
                      <span>{formatRelativeTime(r.answeredAt)}</span>
                      {progress ? (
                        <>
                          <span className="text-zinc-300 dark:text-zinc-700">·</span>
                          <span>{progress} modules</span>
                        </>
                      ) : null}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold text-brand-ink dark:text-brand-soft">
                      {score}
                    </p>
                    <p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                      last 10
                    </p>
                    <Link
                      href={href}
                      className="mt-1 inline-flex text-xs font-semibold text-brand underline-offset-2 hover:underline dark:text-brand-soft"
                    >
                      Jump back in
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </aside>
  );
}

