import type { CourseMode } from "@/types/mentored";

/**
 * Builds the URL the home page's "Open" / "Jump back in" buttons should
 * point at for a given course.
 */
export function buildResumeCourseHref(args: {
  courseId: string;
  lastUsedMode: CourseMode;
  isExploreLearner: boolean;
  materialId?: string;
  moduleId?: number | null;
  lessonIndex?: number | null;
  scrollPosition?: number | null;
}): string {
  const base = args.isExploreLearner
    ? `/explore/${args.courseId}`
    : `/dashboard/courses/${args.courseId}`;
  if (args.lastUsedMode === "mentored") {
    const qs = new URLSearchParams();
    if (args.materialId) qs.set("material", args.materialId);
    if (typeof args.moduleId === "number" && args.moduleId > 0) {
      qs.set("module", String(args.moduleId));
    }
    const q = qs.toString();
    return `${base}/learn${q ? `?${q}` : ""}`;
  }
  const qs = new URLSearchParams();
  qs.set("mode", "learn");
  if (args.materialId) qs.set("material", args.materialId);
  if (typeof args.moduleId === "number" && args.moduleId > 0) {
    qs.set("module", String(args.moduleId));
  }
  if (typeof args.lessonIndex === "number" && args.lessonIndex >= 0) {
    qs.set("lesson", String(args.lessonIndex));
  }
  if (typeof args.scrollPosition === "number" && args.scrollPosition > 0) {
    qs.set("scroll", String(args.scrollPosition));
  }
  const q = qs.toString();
  return `${base}/study${q ? `?${q}` : ""}`;
}
