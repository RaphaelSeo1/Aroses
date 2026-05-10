import Link from "next/link";
import { ModuleMosaic } from "@/components/progress/ModuleMosaic";
import { ProgressRings } from "@/components/progress/ProgressRings";

export function CourseHomeOverview({
  courseId,
  quizAttemptsTotal,
  quizAccuracyPct,
  wrongAttempts,
  modulesCompleted,
  modulesTotal,
  uploadsCount,
}: {
  courseId: string;
  quizAttemptsTotal: number;
  quizAccuracyPct: number | null;
  wrongAttempts: number;
  modulesCompleted: number;
  modulesTotal: number;
  uploadsCount: number;
}) {
  const progressPct =
    modulesTotal > 0
      ? Math.round((modulesCompleted / modulesTotal) * 100)
      : 0;

  return (
    <section className="mt-10 rounded-3xl border border-brand-border bg-brand-blush p-6 shadow-lg shadow-red-900/5 dark:border-brand-border/40 dark:bg-[#1e1616]/95 sm:p-8">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-brand-ink dark:text-white">
            Course home
          </h2>
          <p className="mt-1 text-sm text-brand-muted dark:text-brand-soft">
            Progress, scores, and quick links for this class.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <Link
            href="/dashboard/progress"
            className="rounded-full border border-brand-border bg-white px-4 py-2.5 text-sm font-semibold text-brand-ink shadow-sm hover:bg-white dark:border-brand-border/50 dark:bg-[#1e1616] dark:text-brand-blush dark:hover:bg-[#2a2020]"
          >
            Learning pulse
          </Link>
          <Link
            href={`/dashboard/courses/${courseId}/study`}
            className="rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-red-600/20 hover:bg-brand-hover dark:bg-brand"
          >
            Open study workspace
          </Link>
        </div>
      </div>

      <div className="mt-8 flex flex-col items-center gap-6 rounded-2xl border border-brand-border bg-white px-5 py-6 dark:border-brand-border/40 dark:bg-[#1a1414] sm:flex-row sm:items-start sm:justify-between sm:px-8">
        <div className="flex shrink-0 justify-center sm:justify-start">
          <ProgressRings
            ringId={`home-${courseId.slice(0, 8)}`}
            modulePct={progressPct}
            quizPct={quizAccuracyPct}
            size="lg"
          />
        </div>
        <div className="min-w-0 flex-1 text-center sm:text-left">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-brand-muted">
            Module path
          </p>
          <p className="mt-1 text-sm text-brand-muted dark:text-brand-soft">
            Outer ring = share of lecture checkpoints cleared; inner = quiz
            accuracy when you have attempts.
          </p>
          <div className="mt-4 flex justify-center sm:justify-start">
            <ModuleMosaic
              completed={modulesCompleted}
              total={modulesTotal}
              maxTiles={32}
            />
          </div>
        </div>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-brand-border bg-white p-4 dark:border-brand-border/40 dark:bg-[#1e1616]/80">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-brand-muted">
            Quiz score
          </p>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-brand-ink dark:text-white">
            {quizAccuracyPct !== null ? `${quizAccuracyPct}%` : "—"}
          </p>
          <p className="mt-1 text-xs text-brand-muted dark:text-brand-soft">
            {quizAttemptsTotal > 0
              ? `${quizAttemptsTotal} attempts across quizzes`
              : "No quiz data yet"}
          </p>
        </div>

        <div className="rounded-2xl border border-brand-border bg-white p-4 dark:border-brand-border/40 dark:bg-[#1e1616]/80">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-brand-muted">
            Modules done
          </p>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-brand-ink dark:text-white">
            {modulesCompleted}/{modulesTotal}
          </p>
          <p className="mt-2 text-xs text-brand-muted dark:text-brand-soft">
            Checkpoints across this entire course.
          </p>
        </div>

        <div className="rounded-2xl border border-amber-200/80 bg-amber-50/90 p-4 dark:border-amber-900/50 dark:bg-amber-950/30">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-800 dark:text-amber-400">
            To review
          </p>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-amber-950 dark:text-amber-100">
            {wrongAttempts}
          </p>
          <p className="mt-1 text-xs text-amber-900/90 dark:text-amber-200/90">
            Wrong MCQ attempts recorded — reopen quizzes in study mode to
            practice again.
          </p>
        </div>

        <div className="rounded-2xl border border-brand-border bg-white p-4 dark:border-brand-border/40 dark:bg-[#1e1616]/80">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-brand-muted">
            Lesson units
          </p>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-brand-ink dark:text-white">
            {uploadsCount}
          </p>
          <p className="mt-1 text-xs text-brand-muted dark:text-brand-soft">
            Separate blocks of lessons in this class
          </p>
        </div>
      </div>

      <div className="mt-8 rounded-2xl border border-brand-border bg-brand-blush/50 px-5 py-4 dark:border-brand-border/40 dark:bg-brand-blush/8">
        <p className="text-sm font-medium text-brand-ink dark:text-brand-blush">
          Suggested next steps
        </p>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-brand-ink/90 dark:text-brand-soft/90">
          <li>
            Finish incomplete modules in{" "}
            <Link
              href={`/dashboard/courses/${courseId}/study`}
              className="font-semibold underline underline-offset-2"
            >
              Study workspace
            </Link>{" "}
            — use the sidebar to jump between lectures.
          </li>
          <li>
            Re-run quizzes where you missed questions; wrong attempts are
            counted above so you can track improvement.
          </li>
          <li>
            When new lectures drop, add them from this course&apos;s workspace
            so your path stays up to date.
          </li>
        </ul>
      </div>
    </section>
  );
}
