import type { NotesFocusBucketMeta } from "./notes/hydrate-notes-focus-buckets.ts";
import {
  isGenericFocusTitle,
  isNotesFocusBucketId,
  isNotesOriginFocusCard,
  notesFocusBucketId,
} from "./notes/notes-focus-bucket.ts";
import type { SrsDueByMaterial } from "./srs-due.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normId(id: string | null | undefined): string {
  return (id ?? "").trim().toLowerCase();
}

function noteTitle(
  meta: NotesFocusBucketMeta | undefined,
  sourceLabel: string | null | undefined,
  sourceNoteId: string | null
): string {
  const hydrated = (meta?.fileName ?? "").trim();
  if (hydrated && !isGenericFocusTitle(hydrated)) return hydrated;
  const label = (sourceLabel ?? "").trim();
  if (label && !isGenericFocusTitle(label)) return label;
  if (hydrated) return hydrated;
  if (label) return label;
  return sourceNoteId ? "Notes" : "Focus questions";
}

export function ensureNotesBucket(
  byMaterial: Map<string, SrsDueByMaterial>,
  bucketId: string,
  label: string | null,
  meta?: { courseId: string | null; courseTitle: string | null }
): SrsDueByMaterial {
  let bucket = byMaterial.get(bucketId);
  if (!bucket) {
    bucket = {
      materialId: bucketId,
      fileName: label && !isGenericFocusTitle(label) ? label : label || "Focus questions",
      courseId: meta?.courseId ?? null,
      courseTitle: meta?.courseTitle ?? null,
      module: 0,
      personal: 0,
      total: 0,
    };
    byMaterial.set(bucketId, bucket);
  } else {
    if (label && isGenericFocusTitle(bucket.fileName) && !isGenericFocusTitle(label)) {
      bucket.fileName = label;
    }
    if (meta?.courseTitle && !bucket.courseTitle) {
      bucket.courseTitle = meta.courseTitle;
      bucket.courseId = meta.courseId ?? bucket.courseId;
    }
    if (meta?.courseId && !bucket.courseId) {
      bucket.courseId = meta.courseId;
    }
  }
  return bucket;
}

/**
 * Count a personal/focus card as notes-origin (per-note Review child) or as
 * course-origin (personal on the study material). Notes-origin never folds
 * into an existing PDF child just because material_id was set.
 */
export function addPersonalFocusCount(
  byMaterial: Map<string, SrsDueByMaterial>,
  row: {
    materialId?: string | null;
    sourceNoteId?: string | null;
    sourceLabel?: string | null;
  },
  notesMeta: Map<string, NotesFocusBucketMeta>
): boolean {
  const sourceNoteId =
    typeof row.sourceNoteId === "string" && UUID_RE.test(row.sourceNoteId.trim())
      ? row.sourceNoteId.trim()
      : null;
  const noteBucketId = notesFocusBucketId(sourceNoteId);
  const meta = notesMeta.get(noteBucketId);
  if (meta?.noteDeleted) return false;

  const label = noteTitle(meta, row.sourceLabel, sourceNoteId);
  const notesOrigin = isNotesOriginFocusCard({
    materialId: row.materialId,
    sourceNoteId,
  });

  if (notesOrigin) {
    const bucket = ensureNotesBucket(byMaterial, noteBucketId, label, {
      courseId: meta?.courseId ?? null,
      courseTitle: meta?.courseTitle ?? null,
    });
    bucket.personal += 1;
    return true;
  }

  const rawMid = row.materialId ? normId(row.materialId) : "";
  const hasRealMaterial = Boolean(rawMid) && !isNotesFocusBucketId(rawMid);
  if (hasRealMaterial) {
    const parent = byMaterial.get(rawMid);
    if (!parent) return false;
    parent.personal += 1;
    return true;
  }

  const bucket = ensureNotesBucket(byMaterial, noteBucketId, label, {
    courseId: meta?.courseId ?? null,
    courseTitle: meta?.courseTitle ?? null,
  });
  bucket.personal += 1;
  return true;
}

export function finalizeFocusBuckets(
  byMaterial: Map<string, SrsDueByMaterial>
): { totalModule: number; totalPersonal: number } {
  let totalModule = 0;
  let totalPersonal = 0;
  for (const b of byMaterial.values()) {
    if (b.notes && b.notes.length > 0) {
      b.notes.sort((a, c) => c.total - a.total);
    } else {
      delete b.notes;
    }
    b.total = b.module + b.personal;
    totalModule += b.module;
    totalPersonal += b.personal;
  }
  return { totalModule, totalPersonal };
}
