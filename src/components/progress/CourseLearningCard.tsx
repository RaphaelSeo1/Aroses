import Link from "next/link";
import type { CourseLearningSummary } from "@/lib/learning-stats";
import { displayMaterialSectionLabel } from "@/lib/study-material-display-name";
import { ModuleMosaic } from "@/components/progress/ModuleMosaic";
import { ProgressRings } from "@/components/progress/ProgressRings";

export function CourseLearningCard({ course }: { course: CourseLearningSummary }) {
  const modPct =
    course.modulesTotal > 0
      ? Math.round((course.modulesCompleted / course.modulesTotal) * 100)
      : 0;

  const explore = Boolean(course.isExploreLearner);
  const workspaceHref = explore
    ? `/explore/${course.courseId}`
    : `/dashboard/courses/${course.courseId}`;
  const studyHref = explore
    ? `/explore/${course.courseId}/study?mode=learn`
    : `/dashboard/courses/${course.courseId}/study?mode=learn`;

  return (
    <article className="flex h-full w-full flex-col rounded-2xl border border-brand-border bg-brand-blush p-5 shadow-md shadow-red-900/5 dark:border-brand-border/40 dark:bg-[#1e1616]/95">
      {/* Top row: ring + title + Study button */}
      <div className="flex items-start gap-4">
        <ProgressRings
          ringId={`c-${course.courseId.slice(0, 8)}`}
          modulePct={modPct}
          quizPct={course.quizAccuracyPct}
          size="xs"
          className="shrink-0"
        />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold text-brand-ink dark:text-white">
            <Link
              href={workspaceHref}
              className="hover:text-brand dark:hover:text-brand-soft"
            >
              {course.title}
            </Link>
          </h2>
          {course.description ? (
            <p className="mt-0.5 line-clamp-1 text-xs text-brand-muted dark:text-brand-soft">
              {course.description}
            </p>
          ) : null}
        </div>
        <Link
          href={studyHref}
          className="shrink-0 rounded-full bg-brand px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-brand-hover dark:bg-brand"
        >
          Study
        </Link>
      </div>

      {/* Module path */}
      <div className="mt-4">
        <p className="text-[11px] font-medium text-brand-muted dark:text-brand-soft">
          {course.modulesCompleted}/{course.modulesTotal} checkpoints ·{" "}
          {course.uploadsCount} lesson{course.uploadsCount === 1 ? " unit" : " units"}
        </p>
        <div className="mt-1.5">
          <ModuleMosaic
            completed={course.modulesCompleted}
            total={course.modulesTotal}
          />
        </div>
      </div>

      {/* Inline stats — pill row, no separator */}
      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs">
        <span>
          <span className="font-medium text-brand-muted dark:text-brand-soft">
            Accuracy
          </span>{" "}
          <span className="font-semibold tabular-nums text-brand-ink dark:text-white">
            {course.quizAccuracyPct !== null ? `${course.quizAccuracyPct}%` : "—"}
          </span>
        </span>
        <span>
          <span className="font-medium text-brand-muted dark:text-brand-soft">
            Attempts
          </span>{" "}
          <span className="font-semibold tabular-nums text-brand-ink dark:text-white">
            {course.quizAttempts}
          </span>
        </span>
        <span>
          <span className="font-medium text-brand-muted dark:text-brand-soft">
            Correct
          </span>{" "}
          <span className="font-semibold tabular-nums text-brand dark:text-brand-soft">
            {course.quizAttempts > 0 ? course.quizCorrect : "—"}
          </span>
        </span>
        <Link
          href={workspaceHref}
          className="ml-auto text-xs font-medium text-brand-muted hover:text-brand-ink dark:text-brand-soft dark:hover:text-white"
        >
          {explore ? "Explore" : "Workspace"} →
        </Link>
      </div>

      {course.materials.length > 1 ? (
        <details className="mt-4 rounded-xl border border-zinc-100 bg-zinc-50/80 dark:border-zinc-800 dark:bg-zinc-900/40">
          <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-zinc-600 dark:text-zinc-300">
            {course.materials.length} lesson units · breakdown
          </summary>
          <ul className="max-h-60 space-y-2 overflow-y-auto overscroll-y-contain border-t border-zinc-100 px-3 py-3 dark:border-zinc-800">
            {course.materials.map((m) => (
              <li
                key={m.materialId}
                className="flex flex-wrap items-center justify-between gap-2 text-sm"
              >
                <span className="min-w-0 truncate text-zinc-700 dark:text-zinc-300">
                  {displayMaterialSectionLabel(m.fileName)}
                </span>
                <span className="shrink-0 tabular-nums text-xs text-zinc-500">
                  {m.modulesCompleted}/{m.modulesTotal} modules
                </span>
                <Link
                  href={
                    explore
                      ? `/explore/${course.courseId}/study?material=${m.materialId}&mode=learn`
                      : `/dashboard/courses/${course.courseId}/study?material=${m.materialId}&mode=learn`
                  }
                  className="text-xs font-semibold text-brand hover:underline dark:text-brand-soft"
                >
                  Open
                </Link>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </article>
  );
}
