import type { CourseMode } from "@/types/mentored";

/**
 * Builds the URL the home page's "Open" / "Jump back in" buttons should
 * point at for a given course.
 *
 *   - lastUsedMode === "mentored" → `/learn` (Mentored Learning).
 *     The runner auto-resumes via `user_mentored_sessions` so the
 *     student lands on the chunk they left off on — no extra query
 *     params needed here.
 *
 *   - lastUsedMode === "free" → `/study?mode=learn` (Free Exploration).
 *     The reading view preserves lesson position via its own state.
 *
 * First-time / never-opened courses default to "mentored" upstream
 * (per the SQL default + the dashboard data loader fallback), so this
 * helper only needs to branch on the resolved mode.
 *
 * `isExploreLearner` flips the base from /dashboard to /explore for
 * courses the student is studying via a shared/public listing.
 */
export function buildResumeCourseHref(args: {
  courseId: string;
  lastUsedMode: CourseMode;
  isExploreLearner: boolean;
}): string {
  const base = args.isExploreLearner
    ? `/explore/${args.courseId}`
    : `/dashboard/courses/${args.courseId}`;
  return args.lastUsedMode === "mentored"
    ? `${base}/learn`
    : `${base}/study?mode=learn`;
}
