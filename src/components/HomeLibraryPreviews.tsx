import Link from "next/link";
import type { ReactNode } from "react";
import type { DashboardCourse } from "@/components/CourseDashboardList";
import { buildResumeCourseHref } from "@/lib/dashboard/resume-course-href";
import type { DashboardProgressPayload } from "@/lib/dashboard-progress-data";
import type {
  HomeNotePreview,
  HomeTutorSessionPreview,
} from "@/lib/home-preview-data";
import { tf } from "@/lib/i18n/format";

type Practice = DashboardProgressPayload["recentPractice"][number];

function formatShortDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

function progressPercent(entry: Practice): number | null {
  if (entry.modulesTotal <= 0) return null;
  return Math.min(
    100,
    Math.round((entry.modulesCompleted / entry.modulesTotal) * 100)
  );
}

function LibraryCardShell({
  href,
  title,
  children,
  footer,
}: {
  href: string;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-[9.5rem] flex-col rounded-xl border border-zinc-200/90 bg-white/95 p-4 shadow-sm ring-1 ring-white/50 dark:border-zinc-800 dark:bg-zinc-950/80 dark:ring-zinc-700/30">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          {title}
        </p>
        <Link
          href={href}
          className="shrink-0 text-[11px] font-medium text-zinc-400 hover:text-brand dark:hover:text-brand-soft"
        >
          →
        </Link>
      </div>
      <div className="mt-3 min-h-0 flex-1 space-y-2.5">{children}</div>
      {footer ? <div className="mt-3 border-t border-zinc-100 pt-2 dark:border-zinc-800">{footer}</div> : null}
    </div>
  );
}

function EmptyRow({ label }: { label: string }) {
  return (
    <p className="text-xs leading-relaxed text-zinc-400 dark:text-zinc-500">
      {label}
    </p>
  );
}

export function HomeLibraryPreviews({
  continueEntries,
  ownedCourses,
  recentNotes,
  recentTutorSessions,
  sharedCount,
  copy,
}: {
  continueEntries: Practice[];
  ownedCourses: DashboardCourse[];
  recentNotes: HomeNotePreview[];
  recentTutorSessions: HomeTutorSessionPreview[];
  sharedCount: number;
  copy: {
    continueStudying: string;
    yourCourses: string;
    viewYourNotes: string;
    pastTutorSessions: string;
    sharedWithYou: string;
    browseExplore: string;
    hubSharedHint: string;
    hubExploreHint: string;
    libraryPreviewEmpty: string;
    viewAllArrow: string;
    resumeCourseCta: string;
    resumeProgressModules: string;
  };
}) {
  const continueSlice = continueEntries.slice(0, 2);
  const courseSlice = ownedCourses.slice(0, 2);

  return (
    <nav
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
      aria-label="Your library"
    >
      <LibraryCardShell
        href="/library/continue"
        title={copy.continueStudying}
        footer={
          continueSlice.length > 0 ? (
            <Link
              href="/library/continue"
              className="text-xs font-medium text-zinc-500 hover:text-brand dark:hover:text-brand-soft"
            >
              {copy.viewAllArrow}
            </Link>
          ) : null
        }
      >
        {continueSlice.length === 0 ? (
          <EmptyRow label={copy.libraryPreviewEmpty} />
        ) : (
          continueSlice.map((entry) => {
            const href = buildResumeCourseHref({
              courseId: entry.courseId,
              lastUsedMode: entry.lastUsedMode,
              isExploreLearner: entry.isExploreLearner,
              materialId: entry.materialId,
              moduleId: entry.resumeModuleId,
              lessonIndex: entry.resumeLessonIndex,
              scrollPosition: entry.resumeScrollPosition,
            });
            const pct = progressPercent(entry);
            return (
              <Link
                key={entry.courseId}
                href={href}
                className="block rounded-lg p-1.5 -mx-1.5 transition hover:bg-zinc-50 dark:hover:bg-zinc-900/60"
              >
                <p className="truncate text-xs font-semibold text-zinc-800 dark:text-zinc-100">
                  {entry.title}
                </p>
                {pct != null ? (
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                    <div
                      className="h-full rounded-full bg-emerald-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                ) : entry.modulesTotal > 0 ? (
                  <p className="mt-1 text-[10px] text-zinc-400">
                    {tf(copy.resumeProgressModules, {
                      done: entry.modulesCompleted,
                      total: entry.modulesTotal,
                    })}
                  </p>
                ) : null}
              </Link>
            );
          })
        )}
      </LibraryCardShell>

      <LibraryCardShell
        href="/library/courses"
        title={copy.yourCourses}
        footer={
          courseSlice.length > 0 ? (
            <Link
              href="/library/courses"
              className="text-xs font-medium text-zinc-500 hover:text-brand dark:hover:text-brand-soft"
            >
              {copy.viewAllArrow}
            </Link>
          ) : null
        }
      >
        {courseSlice.length === 0 ? (
          <EmptyRow label={copy.libraryPreviewEmpty} />
        ) : (
          courseSlice.map((c) => (
            <Link
              key={c.id}
              href={`/dashboard/courses/${c.id}`}
              className="block truncate text-xs font-semibold text-zinc-800 transition hover:text-brand dark:text-zinc-100 dark:hover:text-brand-soft"
            >
              {c.title}
            </Link>
          ))
        )}
      </LibraryCardShell>

      <LibraryCardShell
        href="/notes"
        title={copy.viewYourNotes}
        footer={
          recentNotes.length > 0 ? (
            <Link
              href="/notes"
              className="text-xs font-medium text-zinc-500 hover:text-brand dark:hover:text-brand-soft"
            >
              {copy.viewAllArrow}
            </Link>
          ) : null
        }
      >
        {recentNotes.length === 0 ? (
          <EmptyRow label={copy.libraryPreviewEmpty} />
        ) : (
          recentNotes.map((n) => (
            <Link
              key={n.id}
              href={`/notes/doc/${n.id}`}
              className="flex items-baseline justify-between gap-2"
            >
              <span className="truncate text-xs font-semibold text-zinc-800 dark:text-zinc-100">
                {n.title}
              </span>
              <span className="shrink-0 text-[10px] tabular-nums text-zinc-400">
                {formatShortDate(n.updatedAt)}
              </span>
            </Link>
          ))
        )}
      </LibraryCardShell>

      <LibraryCardShell
        href="/sessions"
        title={copy.pastTutorSessions}
        footer={
          recentTutorSessions.length > 0 ? (
            <Link
              href="/sessions"
              className="text-xs font-medium text-zinc-500 hover:text-brand dark:hover:text-brand-soft"
            >
              {copy.viewAllArrow}
            </Link>
          ) : null
        }
      >
        {recentTutorSessions.length === 0 ? (
          <EmptyRow label={copy.libraryPreviewEmpty} />
        ) : (
          recentTutorSessions.map((s) => (
            <Link
              key={s.id}
              href={`/tutor-session/recap/${s.id}`}
              className="flex items-baseline justify-between gap-2"
            >
              <span className="truncate text-xs font-semibold text-zinc-800 dark:text-zinc-100">
                {s.title}
              </span>
              <span className="shrink-0 text-[10px] tabular-nums text-zinc-400">
                {formatShortDate(s.updatedAt)}
              </span>
            </Link>
          ))
        )}
      </LibraryCardShell>

      {/* Simple nav cards */}
      <Link
        href="/library/shared"
        className="group flex h-full min-h-[9.5rem] flex-col rounded-xl border border-zinc-200/90 bg-white/95 p-4 shadow-sm ring-1 ring-white/50 transition hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-950/80 dark:ring-zinc-700/30 dark:hover:border-indigo-800"
      >
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            {copy.sharedWithYou}
          </p>
          {sharedCount > 0 ? (
            <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              {sharedCount}
            </span>
          ) : null}
        </div>
        <p className="mt-2 flex-1 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
          {copy.hubSharedHint}
        </p>
        <span className="mt-2 text-sm text-zinc-300 transition group-hover:translate-x-0.5 group-hover:text-indigo-500 dark:text-zinc-600">
          →
        </span>
      </Link>

      <Link
        href="/explore"
        className="group flex h-full min-h-[9.5rem] flex-col rounded-xl border border-zinc-200/90 bg-white/95 p-4 shadow-sm ring-1 ring-white/50 transition hover:-translate-y-0.5 hover:border-sky-200 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-950/80 dark:ring-zinc-700/30 dark:hover:border-sky-800"
      >
        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          {copy.browseExplore}
        </p>
        <p className="mt-2 flex-1 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
          {copy.hubExploreHint}
        </p>
        <span className="mt-2 text-sm text-zinc-300 transition group-hover:translate-x-0.5 group-hover:text-sky-500 dark:text-zinc-600">
          →
        </span>
      </Link>
    </nav>
  );
}
