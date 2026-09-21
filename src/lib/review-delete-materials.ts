import {
  isNotesFocusBucketId,
  parseNotesFocusBucketNoteId,
} from "@/lib/notes/notes-focus-bucket";

/**
 * Soft-delete selected review/practice decks. Module materials go through
 * study-material soft-delete; notes-focus decks soft-delete via
 * /api/notes/focus-questions. Never hard-deletes a parent course — that would
 * bypass the Deleted section.
 */
export async function deleteReviewMaterials(
  items: { materialId: string; courseId: string | null }[]
): Promise<{ ok: number; failed: number }> {
  let ok = 0;
  let failed = 0;

  for (const item of items) {
    if (isNotesFocusBucketId(item.materialId)) {
      const noteId = parseNotesFocusBucketNoteId(item.materialId);
      const url = noteId
        ? `/api/notes/focus-questions?noteId=${encodeURIComponent(noteId)}`
        : "/api/notes/focus-questions";
      const res = await fetch(url, { method: "DELETE" });
      if (res.ok) ok += 1;
      else failed += 1;
      continue;
    }

    const matRes = await fetch(`/api/study-materials/${item.materialId}`, {
      method: "DELETE",
    });
    if (matRes.ok) {
      ok += 1;
    } else {
      failed += 1;
    }
  }

  return { ok, failed };
}
