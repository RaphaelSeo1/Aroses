import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import {
  CourseDashboardList,
} from "@/components/CourseDashboardList";
import type { DashboardCourse } from "@/components/CourseDashboardList";
import { HeaderNavLoggedIn } from "@/components/HeaderNavLoggedIn";
import { ContinueStudyingCarousel } from "@/components/ContinueStudyingCarousel";
import { HomeRightSidebar } from "@/components/HomeRightSidebar";
import type { DashboardProgressPayload } from "@/lib/dashboard-progress-data";
import type { StudyingCourse } from "@/lib/load-dashboard-courses";

export function DashboardHomeContent({
  userEmail,
  viewerUserId,
  ownedCourses,
  studyingCourses,
  progress,
  omitHeader = false,
}: {
  userEmail: string;
  viewerUserId: string;
  ownedCourses: DashboardCourse[];
  studyingCourses: StudyingCourse[];
  progress: DashboardProgressPayload;
  /** When true, only render main workspace (parent supplies `<AppHeader />`). */
  omitHeader?: boolean;
}) {
  const hasOwned = ownedCourses.length > 0;
  const empty = !hasOwned && studyingCourses.length === 0;

  return (
    <>
      {omitHeader ? null : (
        <AppHeader right={<HeaderNavLoggedIn />} />
      )}
      <main className="min-h-[calc(100vh-4rem)] bg-app-gradient">
        <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
          <div className="grid gap-8 lg:grid-cols-[1fr_22rem] lg:items-start">
            <div className="min-w-0">
              <div className="relative overflow-hidden rounded-3xl border border-zinc-200/90 bg-white/75 p-6 shadow-xl shadow-zinc-900/[0.06] ring-1 ring-white/60 backdrop-blur-md dark:border-zinc-700/80 dark:bg-zinc-950/75 dark:shadow-black/30 dark:ring-zinc-600/40 sm:p-8">
            <div
              className="pointer-events-none absolute -right-24 -top-24 h-56 w-56 rounded-full bg-gradient-to-br from-brand/15 via-brand-soft/10 to-transparent blur-2xl dark:from-brand/25 dark:via-brand/5"
              aria-hidden
            />
            <div className="relative flex flex-col gap-8 sm:flex-row sm:items-end sm:justify-between">
              <div className="max-w-xl">
                <p className="text-xs font-semibold uppercase tracking-wider text-brand dark:text-brand-soft">
                  Home
                </p>
                <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-4xl">
                  Your workspace
                </h1>
                <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                  Courses you create and community courses you&apos;ve practiced.
                  Signed in as{" "}
                  <Link
                    href="/dashboard/profile"
                    className="font-medium text-zinc-900 underline-offset-2 hover:text-brand hover:underline dark:text-zinc-200 dark:hover:text-brand-soft"
                  >
                    {userEmail}
                  </Link>
                  .
                </p>
                {!empty && hasOwned ? (
                  <p className="mt-4 inline-flex items-center gap-2 rounded-full border border-zinc-200/90 bg-zinc-50/90 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/80 dark:text-zinc-400">
                    <span
                      className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]"
                      aria-hidden
                    />
                    {ownedCourses.length}{" "}
                    {ownedCourses.length === 1 ? "course" : "courses"} you manage
                  </p>
                ) : null}
              </div>
              <Link
                href="/dashboard/courses/new"
                className="inline-flex shrink-0 items-center justify-center rounded-full bg-brand px-7 py-3.5 text-sm font-semibold text-white shadow-lg shadow-red-600/30 ring-2 ring-white/20 transition hover:bg-brand-hover hover:shadow-xl hover:shadow-red-600/35 dark:bg-brand dark:ring-white/10 dark:hover:bg-brand-soft"
              >
                + Create course
              </Link>
            </div>
          </div>

              <ContinueStudyingCarousel entries={progress.recentPractice} />

          {empty ? (
            <div className="mx-auto mt-12 max-w-lg rounded-3xl border border-zinc-200/90 bg-white/90 p-10 text-center shadow-lg shadow-zinc-900/5 dark:border-zinc-800 dark:bg-zinc-950/90 dark:shadow-black/20">
              <p className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                Nothing here yet
              </p>
              <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                Create your own course or open something from Explore — once you
                study, it will show up here.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
                <Link
                  href="/dashboard/courses/new"
                  className="inline-flex justify-center rounded-full bg-zinc-900 px-8 py-3 text-sm font-semibold text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-100"
                >
                  Create a course
                </Link>
                <Link
                  href="/explore"
                  className="inline-flex justify-center rounded-full border border-zinc-300 px-8 py-3 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-100 dark:hover:bg-zinc-900"
                >
                  Browse Explore
                </Link>
              </div>
            </div>
          ) : (
            <div className="mt-8 space-y-12 border-t border-zinc-200/80 pt-8 dark:border-zinc-800 sm:mt-10 sm:pt-10">
              {hasOwned ? (
                <section>
                  <div className="flex flex-wrap items-start gap-4">
                    <span
                      className="mt-1 hidden h-10 w-1 shrink-0 rounded-full bg-gradient-to-b from-brand to-red-400 sm:block"
                      aria-hidden
                    />
                    <div>
                      <h2 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-2xl">
                        Your courses
                      </h2>
                      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                        Upload materials, run quizzes, and manage visibility —
                        full creator controls.
                      </p>
                    </div>
                  </div>
                  <CourseDashboardList
                    courses={ownedCourses}
                    viewerUserId={viewerUserId}
                    density="compact"
                    className="mt-5"
                  />
                </section>
              ) : (
                <section className="rounded-2xl border border-dashed border-zinc-300 bg-white/60 px-6 py-8 dark:border-zinc-600 dark:bg-zinc-950/40">
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    No courses you&apos;ve created yet
                  </p>
                  <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                    Start one anytime — or keep learning from Explore below.
                  </p>
                  <Link
                    href="/dashboard/courses/new"
                    className="mt-4 inline-flex rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-hover"
                  >
                    Create a course
                  </Link>
                </section>
              )}

              {/* “Continue learning” (Explore) cards removed — use the black carousel above instead. */}
            </div>
          )}
            </div>
            <div className="hidden lg:block">
              <HomeRightSidebar
                activityBuckets14={progress.activityBuckets}
                recentPractice={progress.recentPractice}
              />
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
