import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { ActivityRhythm } from "@/components/progress/ActivityRhythm";
import { CourseLearningCard } from "@/components/progress/CourseLearningCard";
import { ProgressRings } from "@/components/progress/ProgressRings";
import { HeaderNavLoggedIn } from "@/components/HeaderNavLoggedIn";
import {
  bucketAttemptsLastDays,
  buildCourseSummaries,
} from "@/lib/learning-stats";
import { createClient } from "@/lib/supabase/server";

function last14DayLabels(): string[] {
  const days = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
  const out: string[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    out.push(days[d.getDay()]);
  }
  return out;
}

function missingIsPublicColumn(err: {
  code?: string;
  message?: string;
} | null): boolean {
  if (!err) return false;
  return (
    err.code === "42703" ||
    /is_public|schema cache/i.test(err.message ?? "")
  );
}

export default async function ProgressPage() {
  const supabase = await createClient();

  const primary = await supabase
    .from("courses")
    .select("id, title, description, created_at, sort_order, is_public")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  const fallback =
    primary.error && missingIsPublicColumn(primary.error)
      ? await supabase
          .from("courses")
          .select("id, title, description, created_at, sort_order")
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: true })
      : null;

  const courseRows =
    fallback && !fallback.error ? fallback.data : primary.data;

  const courses =
    courseRows?.map((c) => ({
      id: c.id,
      title: c.title,
      description: c.description,
    })) ?? [];

  const courseIds = courses.map((c) => c.id);

  const { data: materialsRaw } =
    courseIds.length > 0
      ? await supabase
          .from("study_materials")
          .select("id, course_id, file_name, course_payload")
          .in("course_id", courseIds)
      : { data: [] };

  const { data: completionsRaw } = await supabase
    .from("module_completion")
    .select("material_id, module_id");

  const { data: attemptsRaw } = await supabase
    .from("question_attempts")
    .select("material_id, is_correct");

  const since = new Date();
  since.setDate(since.getDate() - 20);
  const { data: recentAnswered } = await supabase
    .from("question_attempts")
    .select("answered_at")
    .gte("answered_at", since.toISOString());

  const { courses: summaries, global } = buildCourseSummaries({
    courses,
    materials: materialsRaw ?? [],
    completions: completionsRaw ?? [],
    attempts: attemptsRaw ?? [],
  });

  const activityBuckets = bucketAttemptsLastDays(
    (recentAnswered ?? []).map((r) => r.answered_at),
    14
  );

  const modPctGlobal =
    global.modulesTotal > 0
      ? Math.round((global.modulesCompleted / global.modulesTotal) * 100)
      : 0;

  const dayLabels = last14DayLabels();

  return (
    <>
      <AppHeader right={<HeaderNavLoggedIn />} />
      <main className="min-h-[calc(100vh-4rem)] bg-app-gradient">
        <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
          <div className="flex flex-col gap-6 border-b border-zinc-200/80 pb-10 dark:border-zinc-800 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-brand dark:text-brand-soft">
                Learning pulse
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                Your progress
              </h1>
              <p className="mt-2 max-w-xl text-zinc-600 dark:text-zinc-400">
                Cross-course checkpoints, quiz accuracy, and how often you
                practiced recently — not just a single progress bar.
              </p>
            </div>
            <Link
              href="/dashboard/courses/new"
              className="inline-flex shrink-0 items-center justify-center rounded-full border border-zinc-300 bg-white px-5 py-2.5 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900"
            >
              + New course
            </Link>
          </div>

          {courses.length === 0 ? (
            <div className="mx-auto mt-16 max-w-lg rounded-3xl border border-zinc-200/90 bg-white/90 p-10 text-center dark:border-zinc-800 dark:bg-zinc-950/90">
              <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                No courses yet
              </p>
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                Create a course and add your class materials to see modules and
                quiz stats here.
              </p>
              <Link
                href="/dashboard/courses/new"
                className="mt-6 inline-flex rounded-full bg-brand px-6 py-3 text-sm font-semibold text-white hover:bg-brand-hover"
              >
                Create a course
              </Link>
            </div>
          ) : (
            <>
              <section className="mt-12 rounded-3xl border border-brand-border bg-brand-blush/80 p-6 shadow-xl shadow-red-900/5 dark:border-brand-border/40 dark:bg-[#1e1616]/95 sm:p-10">
                <div className="flex flex-col gap-10 lg:flex-row lg:items-center lg:justify-between lg:gap-12">
                  <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
                    <ProgressRings
                      ringId="pulse-hero"
                      modulePct={modPctGlobal}
                      quizPct={global.quizAccuracyPct}
                      size="lg"
                    />
                    <div className="max-w-md text-center sm:text-left">
                      <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                        Overall snapshot
                      </h2>
                      <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                        <strong className="font-medium text-zinc-800 dark:text-zinc-200">
                          Outer ring
                        </strong>{" "}
                        tracks module checkpoints across your courses.{" "}
                        <strong className="font-medium text-zinc-800 dark:text-zinc-200">
                          Inner ring
                        </strong>{" "}
                        is your quiz accuracy when you have attempts.
                      </p>
                      <dl className="mt-6 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
                        <div className="rounded-2xl border border-zinc-100 bg-zinc-50/90 px-3 py-3 dark:border-zinc-800 dark:bg-zinc-900/50">
                          <dt className="text-[10px] font-semibold uppercase text-zinc-500">
                            Courses
                          </dt>
                          <dd className="mt-1 text-xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                            {global.coursesStarted}
                          </dd>
                        </div>
                        <div className="rounded-2xl border border-zinc-100 bg-zinc-50/90 px-3 py-3 dark:border-zinc-800 dark:bg-zinc-900/50">
                          <dt className="text-[10px] font-semibold uppercase text-zinc-500">
                            Lesson units
                          </dt>
                          <dd className="mt-1 text-xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                            {global.uploadsTotal}
                          </dd>
                        </div>
                        <div className="rounded-2xl border border-zinc-100 bg-zinc-50/90 px-3 py-3 dark:border-zinc-800 dark:bg-zinc-900/50">
                          <dt className="text-[10px] font-semibold uppercase text-zinc-500">
                            Quiz tries
                          </dt>
                          <dd className="mt-1 text-xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                            {global.quizAttempts}
                          </dd>
                        </div>
                        <div className="rounded-2xl border border-emerald-200/80 bg-emerald-50/80 px-3 py-3 dark:border-emerald-900/50 dark:bg-emerald-950/35">
                          <dt className="text-[10px] font-semibold uppercase text-emerald-800 dark:text-emerald-400">
                            Correct
                          </dt>
                          <dd className="mt-1 text-xl font-semibold tabular-nums text-emerald-800 dark:text-emerald-300">
                            {global.quizAttempts > 0 ? global.quizCorrect : "—"}
                          </dd>
                        </div>
                      </dl>
                    </div>
                  </div>

                  <div className="min-w-0 flex-1 lg:max-w-md">
                    <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                      Practice rhythm (14 days)
                    </h3>
                    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                      Each column is a day — taller means more quiz attempts
                      that day.
                    </p>
                    <div className="mt-4">
                      <ActivityRhythm
                        buckets={activityBuckets}
                        labels={dayLabels}
                      />
                    </div>
                  </div>
                </div>
              </section>

              <section className="mt-14">
                <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                  By course
                </h2>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                  Jump back into anything you&apos;ve started — tiles follow your
                  module checkpoints per class.
                </p>
                <ul className="mt-8 space-y-8">
                  {summaries.map((c) => (
                    <li key={c.courseId}>
                      <CourseLearningCard course={c} />
                    </li>
                  ))}
                </ul>
              </section>

              <p className="mt-12 text-center">
                <Link
                  href="/dashboard"
                  className="text-sm font-medium text-brand hover:underline dark:text-brand-soft"
                >
                  ← My courses (edit order & titles)
                </Link>
              </p>
            </>
          )}
        </div>
      </main>
    </>
  );
}
