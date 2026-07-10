import Link from "next/link";
import { buildResumeCourseHref } from "@/lib/dashboard/resume-course-href";
import type { DashboardProgressPayload } from "@/lib/dashboard-progress-data";
import { tf } from "@/lib/i18n/format";

type Practice = DashboardProgressPayload["recentPractice"][number];

function progressPercent(entry: Practice): number | null {
  if (entry.modulesTotal <= 0) return null;
  return Math.min(
    100,
    Math.round((entry.modulesCompleted / entry.modulesTotal) * 100)
  );
}

/**
 * Stateful home hero: resume the last-studied course, or create-course pitch.
 */
export function HomeResumeHero({
  greetingName,
  resumeEntry,
  primaryAction,
  reviewDueTotal,
  copy,
}: {
  greetingName: string;
  resumeEntry: Practice | null;
  /** Which CTA is the page's single primary action. */
  primaryAction: "resume" | "review" | "create";
  reviewDueTotal: number;
  copy: {
    welcomeBack: string;
    welcomeBackGeneric: string;
    resumeCourseCta: string;
    resumeProgressModules: string;
    resumeProgressPercent: string;
    heroCreatePitchTitle: string;
    heroCreatePitchDesc: string;
    createCourseCta: string;
    createCourseSecondary: string;
    openReviewSecondary: string;
    openReview: string;
  };
}) {
  const greeting = greetingName
    ? tf(copy.welcomeBack, { name: greetingName })
    : copy.welcomeBackGeneric;

  if (!resumeEntry) {
    return (
      <div className="relative overflow-hidden rounded-3xl border border-zinc-200/90 bg-white/75 p-6 shadow-xl shadow-zinc-900/[0.06] ring-1 ring-white/60 backdrop-blur-md dark:border-zinc-700/80 dark:bg-zinc-950/75 dark:shadow-black/30 dark:ring-zinc-600/40 sm:p-8">
        <div
          className="pointer-events-none absolute -right-24 -top-24 h-56 w-56 rounded-full bg-gradient-to-br from-brand/15 via-brand-soft/10 to-transparent blur-2xl dark:from-brand/25 dark:via-brand/5"
          aria-hidden
        />
        <div className="relative flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-xl">
            <p className="text-xs font-semibold uppercase tracking-wider text-brand dark:text-brand-soft">
              {greeting}
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-4xl">
              {copy.heroCreatePitchTitle}
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
              {copy.heroCreatePitchDesc}
            </p>
          </div>
          <Link
            href="/dashboard/courses/new"
            className="inline-flex shrink-0 items-center justify-center rounded-full bg-brand px-7 py-3.5 text-sm font-semibold text-white shadow-lg shadow-red-600/30 ring-2 ring-white/20 transition hover:bg-brand-hover hover:shadow-xl hover:shadow-red-600/35 dark:bg-brand dark:ring-white/10 dark:hover:bg-brand-soft"
          >
            {copy.createCourseCta}
          </Link>
        </div>
      </div>
    );
  }

  const href = buildResumeCourseHref({
    courseId: resumeEntry.courseId,
    lastUsedMode: resumeEntry.lastUsedMode,
    isExploreLearner: resumeEntry.isExploreLearner,
    materialId: resumeEntry.materialId,
    moduleId: resumeEntry.resumeModuleId,
    lessonIndex: resumeEntry.resumeLessonIndex,
    scrollPosition: resumeEntry.resumeScrollPosition,
  });
  const pct = progressPercent(resumeEntry);
  const modulesLabel =
    resumeEntry.modulesTotal > 0
      ? tf(copy.resumeProgressModules, {
          done: resumeEntry.modulesCompleted,
          total: resumeEntry.modulesTotal,
        })
      : null;
  const percentLabel =
    pct != null
      ? tf(copy.resumeProgressPercent, { percent: pct })
      : null;

  const resumeIsPrimary = primaryAction === "resume";
  const reviewIsPrimary = primaryAction === "review";

  return (
    <div className="relative overflow-hidden rounded-3xl border border-zinc-200/90 bg-white/75 p-6 shadow-xl shadow-zinc-900/[0.06] ring-1 ring-white/60 backdrop-blur-md dark:border-zinc-700/80 dark:bg-zinc-950/75 dark:shadow-black/30 dark:ring-zinc-600/40 sm:p-8">
      <div
        className="pointer-events-none absolute -right-24 -top-24 h-56 w-56 rounded-full bg-gradient-to-br from-brand/15 via-brand-soft/10 to-transparent blur-2xl dark:from-brand/25 dark:via-brand/5"
        aria-hidden
      />
      <div className="relative">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand dark:text-brand-soft">
          {greeting}
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-3xl">
          {resumeEntry.title}
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-zinc-600 dark:text-zinc-400">
          {modulesLabel ? <span>{modulesLabel}</span> : null}
          {percentLabel ? (
            <>
              {modulesLabel ? (
                <span className="text-zinc-300 dark:text-zinc-600" aria-hidden>
                  ·
                </span>
              ) : null}
              <span>{percentLabel}</span>
            </>
          ) : null}
        </div>
        {pct != null ? (
          <div className="mt-4 h-2 max-w-md overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
            <div
              className="h-full rounded-full bg-brand transition-[width]"
              style={{ width: `${pct}%` }}
            />
          </div>
        ) : null}

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <Link
            href={href}
            className={
              resumeIsPrimary
                ? "inline-flex items-center justify-center rounded-full bg-brand px-7 py-3 text-sm font-semibold text-white shadow-lg shadow-red-600/30 ring-2 ring-white/20 transition hover:bg-brand-hover dark:ring-white/10 dark:hover:bg-brand-soft"
                : "inline-flex items-center justify-center rounded-full border border-zinc-300 bg-white px-5 py-2.5 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
            }
          >
            {copy.resumeCourseCta}
          </Link>
          {reviewDueTotal > 0 ? (
            <Link
              href="/dashboard/review"
              className={
                reviewIsPrimary
                  ? "inline-flex items-center justify-center rounded-full bg-brand px-7 py-3 text-sm font-semibold text-white shadow-lg shadow-red-600/30 transition hover:bg-brand-hover"
                  : "inline-flex items-center justify-center rounded-full px-4 py-2.5 text-sm font-medium text-zinc-600 underline-offset-2 hover:text-brand hover:underline dark:text-zinc-400 dark:hover:text-brand-soft"
              }
            >
              {reviewIsPrimary ? copy.openReview : copy.openReviewSecondary}
            </Link>
          ) : null}
          <Link
            href="/dashboard/courses/new"
            className="inline-flex items-center justify-center rounded-full px-4 py-2.5 text-sm font-medium text-zinc-500 underline-offset-2 hover:text-zinc-800 hover:underline dark:text-zinc-500 dark:hover:text-zinc-200"
          >
            {copy.createCourseSecondary}
          </Link>
        </div>
      </div>
    </div>
  );
}
