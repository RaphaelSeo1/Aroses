import type { NotesFocusBucketMeta } from "./notes/hydrate-notes-focus-buckets.ts";
import {
  isNotesFocusBucketId,
  notesFocusBucketId,
} from "./notes/notes-focus-bucket.ts";
import type { SrsDueByMaterial, SrsDueNoteChild } from "./srs-due.ts";

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
  if (hydrated && hydrated !== "Notes") return hydrated;
  const label = (sourceLabel ?? "").trim();
  if (label) return label;
  if (hydrated) return hydrated;
  return sourceNoteId ? "Notes" : "Focus questions";
}

function ensureNoteChild(
  parent: SrsDueByMaterial,
  bucketId: string,
  fileName: string,
  sourceNoteId: string | null
): SrsDueNoteChild {
  if (!parent.notes) parent.notes = [];
  let child = parent.notes.find((n) => n.materialId === bucketId);
  if (!child) {
    child = {
      materialId: bucketId,
      sourceNoteId,
      fileName,
      personal: 0,
      total: 0,
    };
    parent.notes.push(child);
  } else {
    if (fileName && (child.fileName === "Focus questions" || child.fileName === "Notes")) {
      child.fileName = fileName;
    }
    if (!child.sourceNoteId && sourceNoteId) child.sourceNoteId = sourceNoteId;
  }
  return child;
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
      fileName: label || "Focus questions",
      courseId: meta?.courseId ?? null,
      courseTitle: meta?.courseTitle ?? null,
      module: 0,
      personal: 0,
      total: 0,
    };
    byMaterial.set(bucketId, bucket);
  } else {
    if (label && (bucket.fileName === "Focus questions" || bucket.fileName === "Notes")) {
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
 * Count a personal/focus card under its course material (nested by note)
 * or as a standalone notes-focus row.
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
  const rawMid = row.materialId ? normId(row.materialId) : "";
  const hasRealMaterial = Boolean(rawMid) && !isNotesFocusBucketId(rawMid);

  if (hasRealMaterial) {
    const parent = byMaterial.get(rawMid);
    if (parent) {
      parent.personal += 1;
      if (sourceNoteId) {
        const child = ensureNoteChild(parent, noteBucketId, label, sourceNoteId);
        child.personal += 1;
        child.total = child.personal;
        if (meta?.courseTitle && !parent.courseTitle) {
          parent.courseTitle = meta.courseTitle;
          parent.courseId = meta.courseId ?? parent.courseId;
        }
      }
      return true;
    }
    if (!sourceNoteId) return false;
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
