import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import type { DashboardCourse } from "@/components/CourseDashboardList";
import { HeaderNavLoggedInServer } from "@/components/HeaderNavLoggedInServer";
import { HomeLibraryPreviews } from "@/components/HomeLibraryPreviews";
import { HomeResumeHero } from "@/components/HomeResumeHero";
import { HomeRightSidebar } from "@/components/HomeRightSidebar";
import { ReviewDueBanner } from "@/components/ReviewDueBanner";
import { PendingCollaboratorInvites } from "@/components/PendingCollaboratorInvites";
import { buildResumeCourseHref } from "@/lib/dashboard/resume-course-href";
import type { DashboardProgressPayload } from "@/lib/dashboard-progress-data";
import type {
  HomeNotePreview,
  HomeTutorSessionPreview,
} from "@/lib/home-preview-data";
import type { SharedCourse, StudyingCourse } from "@/lib/load-dashboard-courses";
import { getT } from "@/lib/i18n/server";
import type { SrsDueCounts } from "@/lib/srs-due";

export async function DashboardHomeContent({
  greetingName,
  ownedCourses,
  studyingCourses,
  sharedCourses = [],
  progress,
  recentNotes = [],
  recentTutorSessions = [],
  initialDueCounts = null,
  omitHeader = false,
}: {
  greetingName: string;
  viewerUserId: string;
  ownedCourses: DashboardCourse[];
  studyingCourses: StudyingCourse[];
  sharedCourses?: SharedCourse[];
  progress: DashboardProgressPayload;
  recentNotes?: HomeNotePreview[];
  recentTutorSessions?: HomeTutorSessionPreview[];
  initialDueCounts?: SrsDueCounts | null;
  /** When true, only render main workspace (parent supplies `<AppHeader />`). */
  omitHeader?: boolean;
}) {
  const t = await getT();
  const hasOwned = ownedCourses.length > 0;
  const hasShared = sharedCourses.length > 0;
  const continueEntries = progress.recentPractice ?? [];
  const continueCount = continueEntries.length;
  const resumeEntry = continueEntries[0] ?? null;
  const isStudyingSomething =
    studyingCourses.length > 0 || continueCount > 0;
  const empty = !hasOwned && !hasShared && !isStudyingSomething;
  const reviewDueTotal = initialDueCounts?.total ?? 0;

  // One primary CTA: cards due → review; mid-course → resume; else create.
  const primaryAction: "review" | "resume" | "create" =
    reviewDueTotal > 0
      ? "review"
      : resumeEntry
        ? "resume"
        : "create";

  const resumeHref = resumeEntry
    ? buildResumeCourseHref({
        courseId: resumeEntry.courseId,
        lastUsedMode: resumeEntry.lastUsedMode,
        isExploreLearner: resumeEntry.isExploreLearner,
        materialId: resumeEntry.materialId,
        moduleId: resumeEntry.resumeModuleId,
        lessonIndex: resumeEntry.resumeLessonIndex,
        scrollPosition: resumeEntry.resumeScrollPosition,
      })
    : null;

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
              <ReviewDueBanner
                initialDueCounts={initialDueCounts}
                demoteCta={primaryAction !== "review"}
              />
              <HomeResumeHero
                greetingName={greetingName}
                resumeEntry={resumeEntry}
                primaryAction={primaryAction}
                reviewDueTotal={reviewDueTotal}
                copy={{
                  welcomeBack: t.dashboard.welcomeBack,
                  welcomeBackGeneric: t.dashboard.welcomeBackGeneric,
                  resumeCourseCta: t.dashboard.resumeCourseCta,
                  resumeProgressModules: t.dashboard.resumeProgressModules,
                  resumeProgressPercent: t.dashboard.resumeProgressPercent,
                  heroCreatePitchTitle: t.dashboard.heroCreatePitchTitle,
                  heroCreatePitchDesc: t.dashboard.heroCreatePitchDesc,
                  createCourseCta: t.dashboard.createCourseCta,
                  createCourseSecondary: t.dashboard.createCourseSecondary,
                  openReviewSecondary: t.dashboard.openReviewSecondary,
                  openReview: t.review.openReview,
                }}
              />

              <section className="mt-8">
                <header className="mb-3 flex items-baseline justify-between">
                  <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                    {t.dashboard.startSomethingNew}
                  </h2>
                </header>
                <div className="grid gap-4 md:grid-cols-3">
                  <Link
                    href="/dashboard/courses/new"
                    className={[
                      "group relative flex h-full flex-col justify-between overflow-hidden rounded-2xl border p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md",
                      primaryAction === "create"
                        ? "border-rose-200 bg-gradient-to-br from-rose-50/60 via-white to-white hover:border-rose-300 dark:border-rose-800 dark:from-rose-950/30 dark:via-zinc-950 dark:to-zinc-950"
                        : "border-zinc-200/90 bg-white/90 hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700",
                    ].join(" ")}
                  >
                    <div className="relative">
                      <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-rose-100 text-rose-700 ring-1 ring-rose-200/70 dark:bg-rose-950/60 dark:text-rose-300 dark:ring-rose-900/50">
                        <svg
                          viewBox="0 0 24 24"
                          className="h-5 w-5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden
                        >
                          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                        </svg>
                      </span>
                      <h3 className="mt-3 text-base font-semibold text-zinc-900 dark:text-zinc-50">
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
                    <div className="relative">
                      <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100 text-violet-700 ring-1 ring-violet-200/70 dark:bg-violet-950/60 dark:text-violet-300 dark:ring-violet-900/50">
                        <svg
                          viewBox="0 0 24 24"
                          className="h-5 w-5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden
                        >
                          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                        </svg>
                      </span>
                      <h3 className="mt-3 text-base font-semibold text-zinc-900 dark:text-zinc-50">
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

                  {/* Live Notes — layout reserved; not linked yet */}
                  <div
                    className="relative flex h-full flex-col justify-between overflow-hidden rounded-2xl border border-dashed border-zinc-200 bg-zinc-50/60 p-5 dark:border-zinc-700 dark:bg-zinc-900/40"
                    aria-disabled
                  >
                    <div className="relative">
                      <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-200/80 text-zinc-500 ring-1 ring-zinc-300/70 dark:bg-zinc-800 dark:text-zinc-400 dark:ring-zinc-700">
                        <svg
                          viewBox="0 0 24 24"
                          className="h-5 w-5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden
                        >
                          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                          <line x1="12" x2="12" y1="19" y2="22" />
                        </svg>
                      </span>
                      <h3 className="mt-3 text-base font-semibold text-zinc-700 dark:text-zinc-200">
                        {t.dashboard.recordLectureTitle}
                      </h3>
                      <p className="mt-1.5 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
                        {t.dashboard.recordLectureDesc}
                      </p>
                    </div>
                    <div className="relative mt-4">
                      <span className="inline-flex rounded-full border border-zinc-300 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-400">
                        {t.dashboard.recordLectureComingSoon}
                      </span>
                    </div>
                  </div>
                </div>
              </section>

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
              ) : null}

              <section className="mt-12 border-t border-zinc-200/80 pt-10 dark:border-zinc-800">
                <header className="mb-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
                    {t.dashboard.libraryEyebrow}
                  </p>
                  <h2 className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                    {t.dashboard.homeLibraryTitle}
                  </h2>
                  <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                    {t.dashboard.homeLibraryDesc}
                  </p>
                </header>
                <HomeLibraryPreviews
                  continueEntries={continueEntries}
                  ownedCourses={ownedCourses}
                  recentNotes={recentNotes}
                  recentTutorSessions={recentTutorSessions}
                  sharedCount={sharedCourses.length}
                  copy={{
                    continueStudying: t.dashboard.continueStudying,
                    yourCourses: t.dashboard.yourCourses,
                    viewYourNotes: t.dashboard.viewYourNotes,
                    pastTutorSessions: t.dashboard.pastTutorSessions,
                    sharedWithYou: t.dashboard.sharedWithYou,
                    browseExplore: t.dashboard.browseExplore,
                    hubSharedHint: t.dashboard.hubSharedHint,
                    hubExploreHint: t.dashboard.hubExploreHint,
                    libraryPreviewEmpty: t.dashboard.libraryPreviewEmpty,
                    viewAllArrow: t.dashboard.viewAllArrow,
                    resumeCourseCta: t.dashboard.resumeCourseCta,
                    resumeProgressModules: t.dashboard.resumeProgressModules,
                  }}
                />
              </section>
            </div>

            <div className="hidden lg:block">
              <HomeRightSidebar
                activityBuckets14={progress.activityBuckets}
                reviewDueTotal={reviewDueTotal}
                resumeTitle={resumeEntry?.title ?? null}
                resumeHref={resumeHref}
              />
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
