import type { CourseProgressPatch } from "@/types/course-progress";
import { readTourDemoCookieFromDocument } from "@/lib/product-tour/tour-demo-cookie";
import { readTourSession } from "@/lib/product-tour/steps";

/**
 * Fire-and-forget course progress update from the browser.
 * Skipped during the onboarding tour so Bio 1A isn't permanently enrolled.
 */
export function touchCourseProgress(
  courseId: string,
  patch: CourseProgressPatch
): void {
  if (!courseId) return;
  if (readTourSession()?.active || readTourDemoCookieFromDocument()) return;
  fetch(`/api/course-progress/${courseId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
    keepalive: true,
  }).catch(() => {});
}
