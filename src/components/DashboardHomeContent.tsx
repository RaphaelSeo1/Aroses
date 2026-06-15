import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import {
  CourseDashboardList,
} from "@/components/CourseDashboardList";
import type { DashboardCourse } from "@/components/CourseDashboardList";
import { HeaderNavLoggedInServer } from "@/components/HeaderNavLoggedInServer";
import { ContinueStudyingCarousel } from "@/components/ContinueStudyingCarousel";
import { HomeRightSidebar } from "@/components/HomeRightSidebar";
import { ReviewDueBanner } from "@/components/ReviewDueBanner";
import type { DashboardProgressPayload } from "@/lib/dashboard-progress-data";
import { PendingCollaboratorInvites } from "@/components/PendingCollaboratorInvites";
import type { SharedCourse, StudyingCourse } from "@/lib/load-dashboard-courses";
import { getT } from "@/lib/i18n/server";
import { tf } from "@/lib/i18n/format";

export async function DashboardHomeContent({
  userEmail,
  viewerUserId,
  ownedCourses,
  studyingCourses,
  sharedCourses = [],
  progress,
  omitHeader = false,
}: {
  userEmail: string;
  viewerUserId: string;
  ownedCourses: DashboardCourse[];
  studyingCourses: StudyingCourse[];
  sharedCourses?: SharedCourse[];
  progress: DashboardProgressPayload;
  /** When true, only render main workspace (parent supplies `<AppHeader />`). */
  omitHeader?: boolean;
}) {
  const t = await getT();
  const hasOwned = ownedCourses.length > 0;
  const hasShared = sharedCourses.length > 0;
  // The "Continue studying" carousel is driven by `progress.recentPractice`,
  // which can have entries even when `studyingCourses` is empty (the two come
  // from different queries). Treat the dashboard as empty only when ALL three
  // sources are empty, so we never render "Nothing here yet" directly below
  // courses the user is actively studying.
  const isStudyingSomething =
    studyingCourses.length > 0 || (progress.recentPractice?.length ?? 0) > 0;
  const empty = !hasOwned && !hasShared && !isStudyingSomething;

  return (
    <>
      {omitHeader ? null : (
        <AppHeader right={<HeaderNavLoggedInServer />} />
      )}
      <main className="min-h-[calc(100vh-4rem)] bg-app-gradient">
        <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
          <div className="grid gap-8 lg:grid-cols-[1fr_22rem] lg:items-start">
            <div className="min-w-0">
              <PendingCollaboratorInvites />
              <ReviewDueBanner />
              <div className="relative overflow-hidden rounded-3xl border border-zinc-200/90 bg-white/75 p-6 shadow-xl shadow-zinc-900/[0.06] ring-1 ring-white/60 backdrop-blur-md dark:border-zinc-700/80 dark:bg-zinc-950/75 dark:shadow-black/30 dark:ring-zinc-600/40 sm:p-8">
            <div
              className="pointer-events-none absolute -right-24 -top-24 h-56 w-56 rounded-full bg-gradient-to-br from-brand/15 via-brand-soft/10 to-transparent blur-2xl dark:from-brand/25 dark:via-brand/5"
              aria-hidden
            />
            <div className="relative flex flex-col gap-8 sm:flex-row sm:items-end sm:justify-between">
              <div className="max-w-xl">
                <p className="text-xs font-semibold uppercase tracking-wider text-brand dark:text-brand-soft">
                  {t.dashboard.homeEyebrow}
                </p>
                <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-4xl">
                  {t.dashboard.yourWorkspace}
                </h1>
                <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                  {t.dashboard.workspaceIntro}{" "}
                  {t.dashboard.signedInAsPrefix}
                  <Link
                    href="/dashboard/profile"
                    className="font-medium text-zinc-900 underline-offset-2 hover:text-brand hover:underline dark:text-zinc-200 dark:hover:text-brand-soft"
                  >
                    {userEmail}
                  </Link>
                  {t.dashboard.signedInAsSuffix}
                </p>
                {!empty && hasOwned ? (
                  <p className="mt-4 inline-flex items-center gap-2 rounded-full border border-zinc-200/90 bg-zinc-50/90 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/80 dark:text-zinc-400">
                    <span
                      className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]"
                      aria-hidden
                    />
                    {tf(
                      ownedCourses.length === 1
                        ? t.dashboard.managedCoursesOne
                        : t.dashboard.managedCoursesMany,
                      { count: ownedCourses.length }
                    )}
                  </p>
                ) : null}
              </div>
              <Link
                href="/dashboard/courses/new"
                className="inline-flex shrink-0 items-center justify-center rounded-full bg-brand px-7 py-3.5 text-sm font-semibold text-white shadow-lg shadow-red-600/30 ring-2 ring-white/20 transition hover:bg-brand-hover hover:shadow-xl hover:shadow-red-600/35 dark:bg-brand dark:ring-white/10 dark:hover:bg-brand-soft"
              >
                {t.dashboard.createCourseCta}
              </Link>
            </div>
          </div>

              {/* Start something new — two equal entry points: courses
                  (structured upload-driven learning) and Tutor Sessions
                  (open conversational tutoring). Sits between the hero
                  card and "Continue studying" so it's the first action
                  surface returning students see. */}
              <section className="mt-8">
                <header className="mb-3 flex items-baseline justify-between">
                  <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                    {t.dashboard.startSomethingNew}
                  </h2>
                </header>
                <div className="grid gap-4 md:grid-cols-2">
                  <Link
                    href="/dashboard/courses/new"
                    className="group relative flex h-full flex-col justify-between overflow-hidden rounded-2xl border border-zinc-200/90 bg-gradient-to-br from-rose-50/60 via-white to-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-rose-200 hover:shadow-md dark:border-zinc-800 dark:from-rose-950/30 dark:via-zinc-950 dark:to-zinc-950 dark:hover:border-rose-800"
                  >
                    <div className="pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full bg-rose-200/40 blur-2xl transition group-hover:bg-rose-200/60 dark:bg-rose-900/30" aria-hidden />
                    <div className="relative">
                      <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-rose-100 text-rose-700 ring-1 ring-rose-200/70 dark:bg-rose-950/60 dark:text-rose-300 dark:ring-rose-900/50">
                        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                        </svg>
                      </span>
                      <h3 className="mt-3 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                        {t.dashboard.createACourse}
                      </h3>
                      <p className="mt-1.5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                        {t.dashboard.createCourseCardDesc}
                      </p>
                    </div>
                    <div className="relative mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-rose-700 transition group-hover:gap-2 dark:text-rose-300">
                      {t.dashboard.uploadMaterial}
                      <span aria-hidden>→</span>
                    </div>
                  </Link>

                  <Link
                    href="/tutor-session"
                    className="group relative flex h-full flex-col justify-between overflow-hidden rounded-2xl border border-zinc-200/90 bg-gradient-to-br from-violet-50/70 via-white to-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-violet-200 hover:shadow-md dark:border-zinc-800 dark:from-violet-950/30 dark:via-zinc-950 dark:to-zinc-950 dark:hover:border-violet-800"
                  >
                    <div className="pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full bg-violet-200/50 blur-2xl transition group-hover:bg-violet-200/70 dark:bg-violet-900/30" aria-hidden />
                    <div className="relative">
                      <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100 text-violet-700 ring-1 ring-violet-200/70 dark:bg-violet-950/60 dark:text-violet-300 dark:ring-violet-900/50">
                        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                        </svg>
                      </span>
                      <h3 className="mt-3 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                        {t.dashboard.startTutorSession}
                      </h3>
                      <p className="mt-1.5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                        {t.dashboard.tutorSessionCardDesc}
                      </p>
                    </div>
                    <div className="relative mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-violet-700 transition group-hover:gap-2 dark:text-violet-300">
                      {t.dashboard.startSession}
                      <span aria-hidden>→</span>
                    </div>
                  </Link>
                </div>
                <div className="mt-2 flex justify-end">
                  <Link
                    href="/sessions"
                    className="text-xs font-medium text-zinc-500 underline-offset-2 hover:text-violet-700 hover:underline dark:text-zinc-500 dark:hover:text-violet-300"
                  >
                    {t.dashboard.pastTutorSessions} →
                  </Link>
                </div>
              </section>

              <ContinueStudyingCarousel entries={progress.recentPractice} />

          {empty ? (
            <div className="mx-auto mt-12 max-w-lg rounded-3xl border border-zinc-200/90 bg-white/90 p-10 text-center shadow-lg shadow-zinc-900/5 dark:border-zinc-800 dark:bg-zinc-950/90 dark:shadow-black/20">
              <p className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                {t.dashboard.nothingHereYet}
              </p>
              <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                {t.dashboard.nothingHereYetDesc}
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
                <Link
                  href="/dashboard/courses/new"
                  className="inline-flex justify-center rounded-full bg-zinc-900 px-8 py-3 text-sm font-semibold text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-100"
                >
                  {t.dashboard.createACourse}
                </Link>
                <Link
                  href="/explore"
                  className="inline-flex justify-center rounded-full border border-zinc-300 px-8 py-3 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-100 dark:hover:bg-zinc-900"
                >
                  {t.dashboard.browseExplore}
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
                        {t.dashboard.yourCourses}
                      </h2>
                      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                        {t.dashboard.yourCoursesDesc}
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
                    {t.dashboard.noCreatedCourses}
                  </p>
                  <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                    {t.dashboard.noCreatedCoursesDesc}
                  </p>
                  <Link
                    href="/dashboard/courses/new"
                    className="mt-4 inline-flex rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-hover"
                  >
                    {t.dashboard.createACourse}
                  </Link>
                </section>
              )}

              {hasShared ? (
                <section>
                  <div className="flex flex-wrap items-start gap-4">
                    <span
                      className="mt-1 hidden h-10 w-1 shrink-0 rounded-full bg-gradient-to-b from-indigo-500 to-violet-400 sm:block"
                      aria-hidden
                    />
                    <div>
                      <h2 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-2xl">
                        {t.dashboard.sharedWithYou}
                      </h2>
                      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                        {t.dashboard.sharedWithYouDesc}
                      </p>
                    </div>
                  </div>
                  <ul className="mt-5 grid gap-3 sm:grid-cols-2">
                    {sharedCourses.map((course) => (
                      <li key={course.id}>
                        <Link
                          href={`/dashboard/courses/${course.id}`}
                          className="block rounded-2xl border border-zinc-200/90 bg-white p-4 shadow-sm transition hover:border-indigo-200 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-indigo-900/50"
                        >
                          <p className="font-semibold text-zinc-900 dark:text-zinc-50">
                            {course.title}
                          </p>
                          {course.description ? (
                            <p className="mt-1 line-clamp-2 text-sm text-zinc-500 dark:text-zinc-400">
                              {course.description}
                            </p>
                          ) : null}
                          <p className="mt-3 text-xs font-medium uppercase tracking-wide text-indigo-600 dark:text-indigo-400">
                            {course.role}
                          </p>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {/* “Continue learning” (Explore) cards removed — use the black carousel above instead. */}
            </div>
          )}
            </div>
            <div className="hidden lg:block">
              <HomeRightSidebar activityBuckets14={progress.activityBuckets} />
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
