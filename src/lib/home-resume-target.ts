import { buildResumeCourseHref } from "@/lib/dashboard/resume-course-href";
import type { DashboardProgressPayload } from "@/lib/dashboard-progress-data";
import type { HomeActivityPreview } from "@/lib/home-preview-data";

type Practice = DashboardProgressPayload["recentPractice"][number];

export type HomeResumeTarget =
  | {
      kind: "course";
      title: string;
      href: string;
      at: string;
      modulesCompleted: number;
      modulesTotal: number;
    }
  | {
      kind: "note";
      title: string;
      href: string;
      at: string;
    }
  | {
      kind: "tutor";
      title: string;
      href: string;
      at: string;
      live: boolean;
    }
  | {
      kind: "live";
      title: string;
      href: string;
      at: string;
      live: boolean;
    };

function ts(iso: string): number {
  const n = Date.parse(iso);
  return Number.isFinite(n) ? n : 0;
}

function courseTarget(entry: Practice): HomeResumeTarget {
  return {
    kind: "course",
    title: entry.title,
    href: buildResumeCourseHref({
      courseId: entry.courseId,
      lastUsedMode: entry.lastUsedMode,
      isExploreLearner: entry.isExploreLearner,
      materialId: entry.materialId,
      moduleId: entry.resumeModuleId,
      lessonIndex: entry.resumeLessonIndex,
      scrollPosition: entry.resumeScrollPosition,
    }),
    at: entry.answeredAt,
    modulesCompleted: entry.modulesCompleted,
    modulesTotal: entry.modulesTotal,
  };
}

function activityTarget(item: HomeActivityPreview): HomeResumeTarget {
  if (item.kind === "tutor") {
    return {
      kind: "tutor",
      title: item.title,
      href: item.href,
      at: item.at,
      live: Boolean(item.live),
    };
  }
  if (item.kind === "live") {
    return {
      kind: "live",
      title: item.title,
      href: item.href,
      at: item.at,
      live: Boolean(item.live),
    };
  }
  return {
    kind: "note",
    title: item.title,
    href: item.href,
    at: item.at,
  };
}

/**
 * Pick the single freshest thing the student was on — course study, notes,
 * live lecture, or tutor — so Welcome back tracks real recent activity.
 */
export function resolveHomeResumeTarget(args: {
  recentPractice: Practice[];
  recentActivity: HomeActivityPreview[];
}): HomeResumeTarget | null {
  const candidates: HomeResumeTarget[] = [];

  // Prefer the freshest non-course activity when timestamps are close — course
  // last_interacted_at is bumped by passive navigation (scroll/module), which
  // otherwise keeps an old course stuck on the hero.
  const course = args.recentPractice[0];
  if (course) candidates.push(courseTarget(course));

  for (const item of args.recentActivity) {
    candidates.push(activityTarget(item));
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const diff = ts(b.at) - ts(a.at);
    if (diff !== 0) return diff;
    // On ties, prefer non-course (notes/tutor/live) over a course.
    if (a.kind === "course" && b.kind !== "course") return 1;
    if (b.kind === "course" && a.kind !== "course") return -1;
    return 0;
  });
  return candidates[0] ?? null;
}
