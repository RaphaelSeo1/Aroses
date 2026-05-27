import type { CourseProgressPatch } from "@/types/course-progress";

/**
 * Fire-and-forget course progress update from the browser.
 */
export function touchCourseProgress(
  courseId: string,
  patch: CourseProgressPatch
): void {
  if (!courseId) return;
  fetch(`/api/course-progress/${courseId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
    keepalive: true,
  }).catch(() => {});
}
