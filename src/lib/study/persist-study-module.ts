/**
 * Fire-and-forget write of the student's current module for a material.
 * Used by Free Exploration (`CoursePlayer`) so resume works even when
 * the student never enters Mentored Learning.
 */
export function persistStudyModulePosition(
  materialId: string,
  moduleId: number
): void {
  if (!materialId || !Number.isFinite(moduleId) || moduleId < 1) return;
  fetch(`/api/mentored/session/${materialId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ moduleId }),
    keepalive: true,
  }).catch(() => {});
}
