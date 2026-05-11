import Link from "next/link";

/**
 * Dashboard course page — owner tools only. Personal study metrics live under
 * Profile → Progress, not mixed with editing.
 */
export function CourseCreatorOverview({
  courseId,
  uploadsCount,
  modulesTotal,
}: {
  courseId: string;
  uploadsCount: number;
  modulesTotal: number;
}) {
  const studyHref = `/dashboard/courses/${courseId}/study`;

  return (
    <section className="mt-10 rounded-3xl border border-brand-border bg-brand-blush p-6 shadow-lg shadow-red-900/5 dark:border-brand-border/40 dark:bg-[#1e1616]/95 sm:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-brand-ink dark:text-white">
            Manage this course
          </h2>
          <p className="mt-1 text-sm text-brand-muted dark:text-brand-soft">
            Edit lessons, quizzes, and uploads here. Your own practice scores and
            streaks stay on{" "}
            <Link
              href="/dashboard/profile?tab=progress"
              className="font-semibold text-brand underline-offset-2 hover:underline dark:text-brand-soft"
            >
              Learning pulse
            </Link>
            .
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <Link
            href="/dashboard/profile?tab=progress"
            className="rounded-full border border-brand-border bg-white px-4 py-2.5 text-sm font-semibold text-brand-ink shadow-sm hover:bg-white dark:border-brand-border/50 dark:bg-[#1e1616] dark:text-brand-blush dark:hover:bg-[#2a2020]"
          >
            Learning pulse
          </Link>
          <Link
            href={studyHref}
            className="rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-red-600/20 hover:bg-brand-hover dark:bg-brand"
          >
            Edit course
          </Link>
        </div>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-brand-border bg-white p-4 dark:border-brand-border/40 dark:bg-[#1e1616]/80">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-brand-muted">
            Lesson units
          </p>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-brand-ink dark:text-white">
            {uploadsCount}
          </p>
          <p className="mt-1 text-xs text-brand-muted dark:text-brand-soft">
            PDFs / materials in this course (below)
          </p>
        </div>
        <div className="rounded-2xl border border-brand-border bg-white p-4 dark:border-brand-border/40 dark:bg-[#1e1616]/80">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-brand-muted">
            Modules generated
          </p>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-brand-ink dark:text-white">
            {modulesTotal}
          </p>
          <p className="mt-1 text-xs text-brand-muted dark:text-brand-soft">
            Total lesson modules across all uploads
          </p>
        </div>
      </div>

      <div className="mt-8 rounded-2xl border border-brand-border bg-brand-blush/50 px-5 py-4 dark:border-brand-border/40 dark:bg-brand-blush/8">
        <p className="text-sm font-medium text-brand-ink dark:text-brand-blush">
          Quick actions
        </p>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-brand-ink/90 dark:text-brand-soft/90">
          <li>
            <Link
              href={studyHref}
              className="font-semibold underline underline-offset-2"
            >
              Edit course
            </Link>{" "}
            — rename modules, tweak lesson text, expand quizzes, and use the
            study sidebar.
          </li>
          <li>
            Drag materials into exam groups and rename uploads in the section
            below.
          </li>
          <li>
            Turn on Explore when you&apos;re ready for others to discover this
            listing (toggle under this card).
          </li>
        </ul>
      </div>
    </section>
  );
}
