import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import {
  CourseDashboardList,
  StudyingCoursesSection,
} from "@/components/CourseDashboardList";
import type { DashboardCourse } from "@/components/CourseDashboardList";
import { HeaderNavLoggedIn } from "@/components/HeaderNavLoggedIn";
import type { StudyingCourse } from "@/lib/load-dashboard-courses";

export function DashboardHomeContent({
  userEmail,
  viewerUserId,
  ownedCourses,
  studyingCourses,
}: {
  userEmail: string;
  viewerUserId: string;
  ownedCourses: DashboardCourse[];
  studyingCourses: StudyingCourse[];
}) {
  const hasOwned = ownedCourses.length > 0;
  const hasStudying = studyingCourses.length > 0;
  const empty = !hasOwned && !hasStudying;

  return (
    <>
      <AppHeader right={<HeaderNavLoggedIn />} />
      <main className="min-h-[calc(100vh-4rem)] bg-app-gradient">
        <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
          <div className="flex flex-col gap-8 border-b border-zinc-200/80 pb-10 dark:border-zinc-800 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-brand dark:text-brand-soft">
                Home
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                Your workspace
              </h1>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
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
            </div>
            <Link
              href="/dashboard/courses/new"
              className="inline-flex shrink-0 items-center justify-center rounded-full bg-brand px-7 py-3.5 text-sm font-semibold text-white shadow-lg shadow-red-600/25 transition hover:bg-brand-hover dark:bg-brand dark:hover:bg-brand-soft"
            >
              + Create course
            </Link>
          </div>

          {empty ? (
            <div className="mx-auto mt-16 max-w-lg rounded-3xl border border-zinc-200/90 bg-white/90 p-10 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-950/90">
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
            <div className="space-y-14">
              {hasOwned ? (
                <section>
                  <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                    Your courses
                  </h2>
                  <p className="mt-2 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
                    Upload materials, run quizzes, and manage visibility — full
                    creator controls.
                  </p>
                  <CourseDashboardList
                    courses={ownedCourses}
                    viewerUserId={viewerUserId}
                    className="mt-6"
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

              <StudyingCoursesSection courses={studyingCourses} />
            </div>
          )}
        </div>
      </main>
    </>
  );
}
