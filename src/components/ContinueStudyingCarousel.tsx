"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useDismissStudyCourse } from "@/components/progress/useDismissStudyCourse";
import { buildResumeCourseHref } from "@/lib/dashboard/resume-course-href";
import { useT } from "@/lib/i18n/LocaleProvider";
import { tf } from "@/lib/i18n/format";
import type { Dictionary } from "@/locales";
import type { CourseMode } from "@/types/mentored";

type Entry = {
  courseId: string;
  materialId: string;
  title: string;
  answeredAt: string;
  correctLast10: number;
  totalLast10: number;
  modulesCompleted: number;
  modulesTotal: number;
  /** Generated uploads / sections in this course (exam groups). */
  uploadsCount?: number;
  isExploreLearner: boolean;
  /**
   * Drives the "Open" button target. "mentored" lands the student on
   * the immersive AI tutor at the lesson they left off on; "free" lands
   * them on the reading view. Resolved server-side from
   * `user_course_mode_prefs` (default mentored for never-opened
   * courses).
   */
  lastUsedMode: CourseMode;
  resumeModuleId: number | null;
  resumeLessonIndex?: number | null;
  resumeScrollPosition?: number | null;
};

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function pct(modDone: number, modTotal: number): number {
  if (!Number.isFinite(modDone) || !Number.isFinite(modTotal) || modTotal <= 0) return 0;
  return clamp(Math.round((modDone / modTotal) * 100), 0, 100);
}

function formatRelativeTime(
  iso: string,
  d: Dictionary["dashboard"]
): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const diffMs = Date.now() - t;
  const min = Math.round(diffMs / 60_000);
  if (min < 60) return tf(d.minutesAgo, { count: min });
  const hr = Math.round(min / 60);
  if (hr < 48) return hr === 1 ? d.oneHourAgo : tf(d.hoursAgo, { count: hr });
  const days = Math.round(hr / 24);
  return days === 1 ? d.yesterday : tf(d.daysAgo, { count: days });
}

export function ContinueStudyingCarousel({
  entries,
  hideViewAll = false,
  viewAllHref = "/dashboard/profile?tab=progress",
  maxItems,
  className = "mt-10",
}: {
  entries: Entry[];
  hideViewAll?: boolean;
  viewAllHref?: string;
  maxItems?: number;
  className?: string;
}) {
  const t = useT();
  const [items, setItems] = useState(entries);
  const { requestDismiss, dismissDialog, error } = useDismissStudyCourse({
    onDismissed: (courseId) => {
      setItems((prev) => prev.filter((e) => e.courseId !== courseId));
    },
  });

  useEffect(() => {
    setItems(entries);
  }, [entries]);

  if (items.length === 0) return null;

  const visible =
    typeof maxItems === "number" ? items.slice(0, maxItems) : items;
  const showViewAll =
    !hideViewAll &&
    (typeof maxItems !== "number" || items.length > maxItems);

  return (
    <section className={className}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            {t.dashboard.forYou}
          </p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-2xl">
            {t.dashboard.continueStudying}
          </h2>
        </div>
        {showViewAll ? (
          <Link
            href={viewAllHref}
            className="text-sm font-semibold text-brand underline-offset-2 hover:underline dark:text-brand-soft"
          >
            {t.dashboard.viewAll} →
          </Link>
        ) : null}
      </div>

      {error ? (
        <p className="mt-3 text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : null}

      <div className="mt-5 -mx-4 px-4 sm:-mx-6 sm:px-6">
        <div className="flex gap-4 overflow-x-auto pb-2 [-webkit-overflow-scrolling:touch] [scrollbar-gutter:stable] snap-x snap-mandatory">
          {visible.map((e) => {
            const progressPct = pct(e.modulesCompleted, e.modulesTotal);
            const score =
              e.totalLast10 > 0 ? `${e.correctLast10}/${e.totalLast10}` : "—";
            const moduleLabel =
              (e.uploadsCount ?? 0) > 1
                ? tf(t.dashboard.checkpointsSections, {
                    checkpoints: e.modulesTotal,
                    sections: e.uploadsCount ?? 0,
                  })
                : e.modulesTotal > 0
                  ? tf(t.dashboard.modulesCount, { count: e.modulesTotal })
                  : null;
            const href = buildResumeCourseHref({
              courseId: e.courseId,
              lastUsedMode: e.lastUsedMode,
              isExploreLearner: e.isExploreLearner,
              materialId: e.materialId,
              moduleId: e.resumeModuleId,
              lessonIndex: e.resumeLessonIndex,
              scrollPosition: e.resumeScrollPosition,
            });

            const detailsHref = e.isExploreLearner
              ? `/explore/${e.courseId}`
              : `/dashboard/courses/${e.courseId}`;

            return (
              <article
                key={e.courseId}
                className="group relative snap-start shrink-0 w-[18.5rem] sm:w-[21rem] overflow-hidden rounded-2xl border border-zinc-200/90 bg-white/95 pt-6 shadow-md shadow-zinc-900/[0.04] ring-1 ring-white/40 transition-[box-shadow,transform,border-color] duration-300 hover:-translate-y-0.5 hover:border-emerald-300/70 hover:shadow-xl hover:shadow-emerald-900/[0.10] motion-reduce:hover:translate-y-0 dark:border-zinc-800 dark:bg-zinc-950/95 dark:ring-zinc-700/30 dark:hover:border-emerald-800/60"
              >
                <div
                  className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-emerald-400 via-emerald-300 to-cyan-300 opacity-90"
                  aria-hidden
                />
                <div
                  className="pointer-events-none absolute -right-24 -top-24 h-56 w-56 rounded-full bg-gradient-to-br from-emerald-500/18 via-cyan-400/10 to-transparent blur-2xl"
                  aria-hidden
                />
                <div className="relative flex items-start justify-between gap-3 px-5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                      {e.title}
                    </p>
                    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                      {formatRelativeTime(e.answeredAt, t.dashboard)}
                      {moduleLabel ? (
                        <>
                          <span className="mx-2 text-zinc-300 dark:text-zinc-700">·</span>
                          {moduleLabel}
                        </>
                      ) : null}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        requestDismiss({
                          courseId: e.courseId,
                          title: e.title,
                          isExploreLearner: e.isExploreLearner,
                        })
                      }
                      className="rounded-full border border-zinc-300/90 bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-zinc-700 shadow-sm transition hover:border-red-300 hover:bg-red-50 hover:text-red-700 dark:border-zinc-600 dark:bg-zinc-900/80 dark:text-zinc-200 dark:hover:border-red-800 dark:hover:bg-red-950/50 dark:hover:text-red-300"
                    >
                      {t.dashboard.remove}
                    </button>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                        {score}
                      </p>
                      <p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                        {t.dashboard.lastTen}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="relative mt-4 px-5">
                  <div className="flex items-center justify-between gap-3 text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    <span>
                      {e.modulesTotal > 0
                        ? tf(t.dashboard.checkpointsDone, {
                            done: e.modulesCompleted,
                            total: e.modulesTotal,
                          })
                        : t.dashboard.progressLabel}
                    </span>
                    <span className="tabular-nums text-zinc-700 dark:text-zinc-300">
                      {progressPct}%
                    </span>
                  </div>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-zinc-200/70 dark:bg-zinc-800/70">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-emerald-400 to-cyan-300"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                </div>

                <div className="relative mt-5 flex items-center justify-between gap-3 px-5 pb-5">
                  <Link
                    href={href}
                    className="inline-flex items-center justify-center rounded-full border border-emerald-200/70 bg-emerald-50/80 px-4 py-2 text-sm font-semibold text-emerald-950 shadow-sm transition hover:border-emerald-300 hover:bg-emerald-100 dark:border-emerald-900/50 dark:bg-emerald-950/35 dark:text-emerald-100 dark:hover:bg-emerald-950/55"
                  >
                    {t.dashboard.openCta} →
                  </Link>
                  <Link
                    href={detailsHref}
                    className="text-xs font-semibold text-zinc-600 underline-offset-2 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100"
                  >
                    {t.dashboard.details}
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      </div>
      {dismissDialog}
    </section>
  );
}
