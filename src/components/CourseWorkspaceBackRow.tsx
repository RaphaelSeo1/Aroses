import Link from "next/link";

/**
 * Full-width bar under the site header — replaces “Course home” in the main nav.
 */
export function CourseWorkspaceBackRow({
  courseId,
  courseTitle,
}: {
  courseId: string;
  courseTitle: string;
}) {
  return (
    <div className="border-b border-zinc-200 bg-zinc-50/90 px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-900/50 sm:px-6">
      <div className="mx-auto flex max-w-7xl items-center gap-3">
        <Link
          href={`/dashboard/courses/${courseId}`}
          className="inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-zinc-800 underline-offset-2 hover:text-brand hover:underline dark:text-zinc-100 dark:hover:text-brand-soft"
        >
          <span aria-hidden className="text-zinc-500 dark:text-zinc-400">
            ←
          </span>
          Back to course
        </Link>
        <span
          className="min-w-0 truncate text-xs text-zinc-500 dark:text-zinc-400 sm:text-sm"
          title={courseTitle}
        >
          {courseTitle}
        </span>
      </div>
    </div>
  );
}
