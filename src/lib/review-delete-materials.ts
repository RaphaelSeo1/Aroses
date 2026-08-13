/**
 * Delete selected review/practice decks. Prefers deleting the study material;
 * if the user can't edit that row but owns the parent course, delete the course.
 */
export async function deleteReviewMaterials(
  items: { materialId: string; courseId: string | null }[]
): Promise<{ ok: number; failed: number }> {
  let ok = 0;
  let failed = 0;
  const deletedCourseIds = new Set<string>();

  for (const item of items) {
    if (item.courseId && deletedCourseIds.has(item.courseId)) {
      ok += 1;
      continue;
    }

    const matRes = await fetch(`/api/study-materials/${item.materialId}`, {
      method: "DELETE",
    });
    if (matRes.ok) {
      ok += 1;
      continue;
    }

    if (item.courseId) {
      const courseRes = await fetch(`/api/courses/${item.courseId}`, {
        method: "DELETE",
      });
      if (courseRes.ok) {
        deletedCourseIds.add(item.courseId);
        ok += 1;
        continue;
      }
    }

    failed += 1;
  }

  return { ok, failed };
}
