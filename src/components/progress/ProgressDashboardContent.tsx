import Link from "next/link";
import { APP_NAME } from "@/lib/brand";
import { ActivityRhythm } from "@/components/progress/ActivityRhythm";
import { ProgressCourseList } from "@/components/progress/ProgressCourseList";
import { ProgressRings } from "@/components/progress/ProgressRings";
import type { DashboardProgressPayload } from "@/lib/dashboard-progress-data";

type Props = {
  data: DashboardProgressPayload;
  /** Extra actions beside the title (e.g. Explore / Create). */
  showTopActions?: boolean;
  /**
   * `panel` — embedded in Profile settings (narrow card): stack sections, tighter rings.
   * `page` — wider canvas: allow side‑by‑side hero on xl screens.
   */
  layout?: "page" | "panel";
};

export function ProgressDashboardContent({
  data,
  showTopActions = false,
  layout = "page",
}: Props) {
  const { hasCourses, summaries, global, activityBuckets, dayLabels } = data;
  const isPanel = layout === "panel";

  const modPctGlobal =
    global.modulesTotal > 0
      ? Math.round((global.modulesCompleted / global.modulesTotal) * 100)
      : 0;

  const heroSplit =
    isPanel
      ? "flex flex-col gap-6"
      : "flex flex-col gap-6 lg:flex-row lg:items-stretch lg:justify-between lg:gap-8";

  return (
    <div className="space-y-8">
      {showTopActions ? (
        <div className="flex flex-col gap-5 border-b border-zinc-200/80 pb-8 dark:border-zinc-800">
          <div className="space-y-2">
            <p className="text-xs font-semibold tracking-wider text-brand dark:text-brand-soft">
              {APP_NAME}
            </p>
            <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-3xl">
              Your progress
            </h2>
            <p className="max-w-2xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
              Cross-course checkpoints, quiz accuracy, and how often you
              practiced recently — not just a single progress bar.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/explore"
              className="inline-flex items-center justify-center rounded-full border border-brand/40 bg-brand-blush/90 px-5 py-2.5 text-sm font-semibold text-brand-ink hover:bg-brand-blush dark:border-brand-border/50 dark:bg-[#1e1616]/80 dark:text-brand-soft dark:hover:bg-[#2a2020]"
            >
              Explore courses
            </Link>
            <Link
              href="/dashboard/courses/new"
              className="inline-flex items-center justify-center rounded-full border border-zinc-300 bg-white px-5 py-2.5 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900"
            >
              Create a course
            </Link>
          </div>
        </div>
      ) : null}

      {!hasCourses ? (
        <div className="rounded-2xl border border-zinc-200/90 bg-zinc-50/80 p-8 text-center dark:border-zinc-800 dark:bg-zinc-900/40 sm:p-10">
          <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            No courses yet
          </p>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Create a course and add your class materials to see modules and quiz
            stats here — or study something from the community on Explore.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Link
              href="/explore"
              className="inline-flex justify-center rounded-full border border-brand/40 bg-brand-blush/90 px-6 py-3 text-sm font-semibold text-brand-ink hover:bg-brand-blush dark:border-brand-border/50 dark:bg-[#1e1616]/80 dark:text-brand-soft dark:hover:bg-[#2a2020]"
            >
              Explore courses
            </Link>
            <Link
              href="/dashboard/courses/new"
              className="inline-flex justify-center rounded-full bg-brand px-6 py-3 text-sm font-semibold text-white hover:bg-brand-hover"
            >
              Create a course
            </Link>
          </div>
        </div>
      ) : (
        <>
          <section className="rounded-2xl border border-brand-border bg-brand-blush/80 p-4 shadow-md shadow-red-900/5 dark:border-brand-border/40 dark:bg-[#1e1616]/95 sm:p-6">
            <div className={heroSplit}>
              <div className="flex min-w-0 flex-1 flex-col items-center gap-6 sm:flex-row sm:items-center">
                <ProgressRings
                  ringId="pulse-hero"
                  modulePct={modPctGlobal}
                  quizPct={global.quizAccuracyPct}
                  size={isPanel ? "sm" : "lg"}
                  className="shrink-0"
                />
                <div className="min-w-0 flex-1 text-center sm:text-left">
                  <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
                    Overall snapshot
                  </h3>
                  <p className="mt-1 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                    <strong className="font-medium text-zinc-800 dark:text-zinc-200">
                      Outer ring
                    </strong>{" "}
                    = modules ·{" "}
                    <strong className="font-medium text-zinc-800 dark:text-zinc-200">
                      inner
                    </strong>{" "}
                    = quiz accuracy.
                  </p>
                  <dl className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                    <div className="rounded-xl border border-zinc-100 bg-zinc-50/90 px-2.5 py-2 dark:border-zinc-800 dark:bg-zinc-900/50">
                      <dt className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                        Courses
                      </dt>
                      <dd className="mt-0.5 text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                        {global.coursesStarted}
                      </dd>
                    </div>
                    <div className="rounded-xl border border-zinc-100 bg-zinc-50/90 px-2.5 py-2 dark:border-zinc-800 dark:bg-zinc-900/50">
                      <dt className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                        Lessons
                      </dt>
                      <dd className="mt-0.5 text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                        {global.uploadsTotal}
                      </dd>
                    </div>
                    <div className="rounded-xl border border-zinc-100 bg-zinc-50/90 px-2.5 py-2 dark:border-zinc-800 dark:bg-zinc-900/50">
                      <dt className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                        Quiz tries
                      </dt>
                      <dd className="mt-0.5 text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                        {global.quizAttempts}
                      </dd>
                    </div>
                    <div className="rounded-xl border border-emerald-200/80 bg-emerald-50/80 px-2.5 py-2 dark:border-emerald-900/50 dark:bg-emerald-950/35">
                      <dt className="text-[10px] font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-400">
                        Correct
                      </dt>
                      <dd className="mt-0.5 text-lg font-semibold tabular-nums text-emerald-800 dark:text-emerald-300">
                        {global.quizAttempts > 0 ? global.quizCorrect : "—"}
                      </dd>
                    </div>
                  </dl>
                </div>
              </div>

              <div
                className={
                  isPanel
                    ? "w-full min-w-0"
                    : "flex w-full min-w-0 flex-col lg:max-w-sm lg:flex-1"
                }
              >
                <div
                  className={
                    isPanel
                      ? "rounded-xl border border-zinc-200/90 bg-white/70 p-3 shadow-sm dark:border-zinc-700/80 dark:bg-zinc-950/40"
                      : "rounded-xl border border-zinc-200/60 bg-white/50 p-3 dark:border-zinc-700/60 dark:bg-zinc-950/30"
                  }
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                      Practice rhythm
                    </h4>
                    <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                      Last 14 days
                    </span>
                  </div>
                  <div className="mt-3">
                    <ActivityRhythm
                      buckets={activityBuckets}
                      labels={dayLabels}
                    />
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                By course
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {summaries.length} {summaries.length === 1 ? "course" : "courses"} ·
                use <span className="font-semibold text-zinc-700 dark:text-zinc-300">Remove</span>{" "}
                to hide a course from Continue studying
              </p>
            </div>
            <ProgressCourseList courses={summaries} />
          </section>

          <p className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 border-t border-zinc-100 pt-8 text-center dark:border-zinc-800">
            <Link
              href="/dashboard/profile?tab=general"
              className="text-sm font-medium text-zinc-600 hover:text-brand hover:underline dark:text-zinc-400 dark:hover:text-brand-soft"
            >
              General settings
            </Link>
            <span className="hidden text-zinc-300 sm:inline dark:text-zinc-600">
              ·
            </span>
            <Link
              href="/"
              className="text-sm font-medium text-brand hover:underline dark:text-brand-soft"
            >
              ← Home (edit order & titles)
            </Link>
          </p>
        </>
      )}
    </div>
  );
}
