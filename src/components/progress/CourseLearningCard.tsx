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

  return (
    <article className="flex flex-col rounded-3xl border border-brand-border bg-brand-blush p-6 shadow-lg shadow-red-900/5 dark:border-brand-border/40 dark:bg-[#1e1616]/95 sm:flex-row sm:gap-8">
      <div className="flex shrink-0 justify-center sm:justify-start">
        <ProgressRings
          ringId={`c-${course.courseId.slice(0, 8)}`}
          modulePct={modPct}
          quizPct={course.quizAccuracyPct}
          size="sm"
        />
      </div>

      <div className="mt-6 min-w-0 flex-1 sm:mt-0">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-brand-ink dark:text-white">
              <Link
                href={`/dashboard/courses/${course.courseId}`}
                className="hover:text-brand dark:hover:text-brand-soft"
              >
                {course.title}
              </Link>
            </h2>
            {course.description ? (
              <p className="mt-1 line-clamp-2 text-sm text-brand-muted dark:text-brand-soft">
                {course.description}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-col gap-2 sm:items-end">
            <Link
              href={`/dashboard/courses/${course.courseId}/study`}
              className="rounded-full bg-brand px-4 py-2 text-center text-sm font-semibold text-white hover:bg-brand-hover dark:bg-brand"
            >
              Study
            </Link>
            <Link
              href={`/dashboard/courses/${course.courseId}`}
              className="text-center text-xs font-medium text-brand-muted hover:text-brand-ink dark:text-brand-soft dark:hover:text-white"
            >
              Course workspace
            </Link>
          </div>
        </div>

        <div className="mt-5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-muted">
            Module path
          </p>
          <p className="mt-1 text-xs text-brand-muted dark:text-brand-soft">
            {course.modulesCompleted}/{course.modulesTotal} checkpoints ·{" "}
            {course.uploadsCount} lesson{" "}
            {course.uploadsCount === 1 ? "unit" : "units"} in this course
          </p>
          <div className="mt-2">
            <ModuleMosaic
              completed={course.modulesCompleted}
              total={course.modulesTotal}
            />
          </div>
        </div>

        <div className="mt-5 grid gap-3 border-t border-brand-border pt-5 dark:border-brand-border/40 sm:grid-cols-3">
          <div>
            <p className="text-[10px] font-semibold uppercase text-brand-muted">
              Quiz accuracy
            </p>
            <p className="mt-0.5 text-xl font-semibold tabular-nums text-brand-ink dark:text-white">
              {course.quizAccuracyPct !== null
                ? `${course.quizAccuracyPct}%`
                : "—"}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase text-brand-muted">
              Attempts
            </p>
            <p className="mt-0.5 text-xl font-semibold tabular-nums text-brand-ink dark:text-white">
              {course.quizAttempts}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase text-zinc-500">
              Correct
            </p>
            <p className="mt-0.5 text-xl font-semibold tabular-nums text-brand dark:text-brand-soft">
              {course.quizAttempts > 0 ? course.quizCorrect : "—"}
            </p>
          </div>
        </div>

        {course.materials.length > 1 ? (
          <details className="mt-4 rounded-xl border border-zinc-100 bg-zinc-50/80 dark:border-zinc-800 dark:bg-zinc-900/40">
            <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-zinc-600 dark:text-zinc-300">
              {course.materials.length} lesson units · expand for a breakdown
            </summary>
            <ul className="space-y-2 border-t border-zinc-100 px-3 py-3 dark:border-zinc-800">
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
                    href={`/dashboard/courses/${course.courseId}/study?material=${m.materialId}`}
                    className="text-xs font-semibold text-brand hover:underline dark:text-brand-soft"
                  >
                    Open
                  </Link>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </article>
  );
}
