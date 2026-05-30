import { touchCourseProgress } from "@/lib/course-progress/touch-client";
import type { StoredCourseMode } from "@/types/course-progress";

/**
 * Fire-and-forget write of the student's current position in Free Exploration.
 */
export function persistStudyModulePosition(
  courseId: string,
  materialId: string,
  moduleId: number,
  opts?: {
    lessonIndex?: number;
    scrollPosition?: number;
    mode?: StoredCourseMode;
  }
): void {
  if (!courseId || !materialId || !Number.isFinite(moduleId) || moduleId < 1) {
    return;
  }
  touchCourseProgress(courseId, {
    materialId,
    lastModuleId: moduleId,
    lastMode: opts?.mode ?? "free",
    ...(typeof opts?.lessonIndex === "number"
      ? { lastLessonIndex: opts.lessonIndex }
      : {}),
    ...(typeof opts?.scrollPosition === "number"
      ? { lastScrollPosition: opts.scrollPosition }
      : {}),
  });
}
