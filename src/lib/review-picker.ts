import type { NotesHubKind } from "./notes/hydrate-notes-focus-buckets.ts";
import {
  isGenericFocusTitle,
  isNotesFocusBucketId,
  NOTES_FOCUS_BUCKET_ID,
  parseNotesFocusBucketNoteId,
} from "./notes/notes-focus-bucket.ts";
import type { SrsDueByMaterial, SrsDueNoteChild } from "./srs-due.ts";

export const HUB_STANDALONE_GROUP_ID = "hub:standalone";
export const HUB_LIVE_GROUP_ID = "hub:live";
export const HUB_TUTOR_GROUP_ID = "hub:tutor";

export function notesSectionGroupId(sectionId: string): string {
  return `section:${normId(sectionId)}`;
}

export type ReviewPickerSource = {
  materialId: string;
  fileName: string;
  courseId: string | null;
  courseTitle: string | null;
  module: number;
  personal: number;
  total: number;
  notes?: SrsDueNoteChild[];
  sectionId?: string | null;
  sectionTitle?: string | null;
  hubKind?: NotesHubKind | null;
};

export type ReviewPickerChild = {
  id: string;
  kind: "module" | "note";
  fileName: string;
  module: number;
  personal: number;
  total: number;
  courseId: string | null;
  sourceNoteId: string | null;
};

export type ReviewPickerGroup = {
  /** `course:{id}`, `section:{id}`, `hub:*`, `material:{id}`, or a notes-focus bucket id. */
  id: string;
  courseId: string | null;
  courseTitle: string | null;
  fileName: string;
  module: number;
  personal: number;
  total: number;
  children: ReviewPickerChild[];
  leafIds: string[];
  sectionId?: string | null;
  hubKind?: NotesHubKind | null;
};

function normId(id: string | null | undefined): string {
  return (id ?? "").trim().toLowerCase();
}

function meaningfulCourseTitle(title: string | null | undefined): string | null {
  const s = (title ?? "").trim();
  if (!s || s.toLowerCase() === "notes") return null;
  return s;
}

function unattributedPersonal(item: ReviewPickerSource): number {
  const nested = (item.notes ?? []).reduce((n, child) => n + child.personal, 0);
  return Math.max(0, item.personal - nested);
}

type Acc = {
  id: string;
  courseId: string | null;
  courseTitle: string | null;
  fileName: string;
  materials: ReviewPickerSource[];
  notes: Map<string, ReviewPickerChild>;
  sectionId?: string | null;
  hubKind?: NotesHubKind | null;
};

function notesHubGroupId(item: ReviewPickerSource): string | null {
  if (!isNotesFocusBucketId(item.materialId)) return null;
  if (!parseNotesFocusBucketNoteId(item.materialId)) return null;
  // Hub folder identity wins over a stamped course_id so notes-section
  // decks never fold into a similarly titled course lecture.
  const sectionId = item.sectionId?.trim();
  if (sectionId) return notesSectionGroupId(sectionId);
  if (item.courseId) return null;
  if (item.hubKind === "live") return HUB_LIVE_GROUP_ID;
  if (item.hubKind === "tutor") return HUB_TUTOR_GROUP_ID;
  return HUB_STANDALONE_GROUP_ID;
}

function notesHubGroupTitle(item: ReviewPickerSource): string {
  const sectionTitle = (item.sectionTitle ?? "").trim();
  if (sectionTitle) return sectionTitle;
  if (item.hubKind === "live") return "Live lectures";
  if (item.hubKind === "tutor") return "Tutor sessions";
  return "My notes";
}

function upsertNote(acc: Acc, child: ReviewPickerChild): void {
  const key = child.id;
  const existing = acc.notes.get(key);
  if (!existing) {
    acc.notes.set(key, { ...child });
    return;
  }
  existing.personal += child.personal;
  existing.module += child.module;
  existing.total = existing.module + existing.personal;
  if (
    child.fileName &&
    (existing.fileName === "Focus questions" || existing.fileName === "Notes")
  ) {
    existing.fileName = child.fileName;
  }
  if (!existing.sourceNoteId && child.sourceNoteId) {
    existing.sourceNoteId = child.sourceNoteId;
  }
}

function ensureAcc(
  map: Map<string, Acc>,
  key: string,
  seed: {
    courseId: string | null;
    courseTitle: string | null;
    fileName: string;
    sectionId?: string | null;
    hubKind?: NotesHubKind | null;
  }
): Acc {
  let acc = map.get(key);
  if (!acc) {
    acc = {
      id: key,
      courseId: seed.courseId,
      courseTitle: meaningfulCourseTitle(seed.courseTitle),
      fileName: seed.fileName,
      materials: [],
      notes: new Map(),
      sectionId: seed.sectionId ?? null,
      hubKind: seed.hubKind ?? null,
    };
    map.set(key, acc);
    return acc;
  }
  const title = meaningfulCourseTitle(seed.courseTitle);
  if (!acc.courseTitle && title) acc.courseTitle = title;
  if (!acc.courseId && seed.courseId) acc.courseId = seed.courseId;
  if (!acc.sectionId && seed.sectionId) acc.sectionId = seed.sectionId;
  if (!acc.hubKind && seed.hubKind) acc.hubKind = seed.hubKind;
  if (seed.fileName && isGenericFocusTitle(acc.fileName) && !isGenericFocusTitle(seed.fileName)) {
    acc.fileName = seed.fileName;
  }
  return acc;
}

function noteChildFromSource(
  item: ReviewPickerSource | SrsDueNoteChild,
  courseId: string | null
): ReviewPickerChild {
  const sourceNoteId =
    "sourceNoteId" in item && item.sourceNoteId
      ? item.sourceNoteId
      : parseNotesFocusBucketNoteId(item.materialId);
  return {
    id: item.materialId,
    kind: "note",
    fileName: item.fileName || "Focus questions",
    module: 0,
    personal: item.personal,
    total: item.personal,
    courseId,
    sourceNoteId,
  };
}

function finalize(acc: Acc): ReviewPickerGroup {
  const children: ReviewPickerChild[] = [];
  for (const material of acc.materials) {
    const extraPersonal = unattributedPersonal(material);
    if (material.module > 0 || extraPersonal > 0) {
      children.push({
        id: material.materialId,
        kind: "module",
        fileName: material.fileName || "Course content",
        module: material.module,
        personal: extraPersonal,
        total: material.module + extraPersonal,
        courseId: acc.courseId ?? material.courseId,
        sourceNoteId: null,
      });
    }
  }
  const notes = [...acc.notes.values()].sort((a, b) => b.total - a.total);
  children.push(...notes);

  const module = children.reduce((n, c) => n + c.module, 0);
  const personal = children.reduce((n, c) => n + c.personal, 0);
  const leafIds =
    children.length > 0 ? children.map((c) => c.id) : [acc.id];

  return {
    id: acc.id,
    courseId: acc.courseId,
    courseTitle: acc.courseTitle,
    fileName: acc.fileName,
    module,
    personal,
    total: module + personal,
    children,
    leafIds,
    sectionId: acc.sectionId ?? null,
    hubKind: acc.hubKind ?? null,
  };
}

/** Group due/practice rows: course parent → module + note-title children. */
export function groupReviewPickerRows(
  items: ReviewPickerSource[]
): ReviewPickerGroup[] {
  const byKey = new Map<string, Acc>();
  const standalone: ReviewPickerGroup[] = [];

  for (const item of items) {
    if (item.total <= 0 && (item.notes?.length ?? 0) === 0) continue;

    if (isNotesFocusBucketId(item.materialId)) {
      const hubKey = notesHubGroupId(item);
      if (hubKey) {
        const hubKind: NotesHubKind =
          item.sectionId?.trim()
            ? "custom"
            : item.hubKind === "live" || item.hubKind === "tutor"
              ? item.hubKind
              : "standalone";
        const acc = ensureAcc(byKey, hubKey, {
          courseId: null,
          courseTitle: null,
          fileName: notesHubGroupTitle(item),
          sectionId: item.sectionId ?? null,
          hubKind,
        });
        upsertNote(acc, noteChildFromSource(item, null));
      } else if (item.courseId) {
        const courseId = item.courseId;
        const courseTitle = meaningfulCourseTitle(item.courseTitle);
        const key = `course:${normId(courseId)}`;
        const acc = ensureAcc(byKey, key, {
          courseId,
          courseTitle,
          fileName: courseTitle || item.fileName,
        });
        upsertNote(acc, noteChildFromSource(item, courseId));
      } else {
        standalone.push({
          id: item.materialId,
          courseId: null,
          courseTitle: null,
          fileName: item.fileName || "Focus questions",
          module: 0,
          personal: item.personal,
          total: item.personal,
          children: [],
          leafIds: [item.materialId],
        });
      }
      continue;
    }

    const courseId = item.courseId;
    const key = courseId
      ? `course:${normId(courseId)}`
      : `material:${normId(item.materialId)}`;
    const acc = ensureAcc(byKey, key, {
      courseId,
      courseTitle: item.courseTitle,
      fileName: item.fileName,
    });
    acc.materials.push(item);
    for (const note of item.notes ?? []) {
      upsertNote(acc, noteChildFromSource(note, courseId));
    }
  }

  const grouped = [...byKey.values()].map(finalize);
  const out = [...grouped, ...standalone].filter((g) => g.total > 0);
  out.sort((a, b) => b.total - a.total);
  return out;
}

export function allPickerLeafIds(groups: ReviewPickerGroup[]): string[] {
  const ids: string[] = [];
  for (const group of groups) ids.push(...group.leafIds);
  return ids;
}

export function pickerParentLabel(
  group: ReviewPickerGroup,
  fallbacks: {
    focusQuestions: string;
    courseFallback: string;
    myNotes?: string;
    liveLectures?: string;
    tutorSessions?: string;
  }
): string {
  if (group.hubKind === "live") {
    return fallbacks.liveLectures || group.fileName || "Live lectures";
  }
  if (group.hubKind === "tutor") {
    return fallbacks.tutorSessions || group.fileName || "Tutor sessions";
  }
  if (group.hubKind === "standalone") {
    return fallbacks.myNotes || group.fileName || "My notes";
  }
  if (group.hubKind === "custom") {
    const sectionName = (group.fileName || "").trim();
    if (sectionName) return sectionName;
  }
  if (group.courseTitle) return group.courseTitle;
  if (group.courseId) return fallbacks.courseFallback;
  const name = (group.fileName || "").trim();
  if (name && !isGenericFocusTitle(name)) return name;
  if (
    group.id === NOTES_FOCUS_BUCKET_ID ||
    (isNotesFocusBucketId(group.id) && !parseNotesFocusBucketNoteId(group.id))
  ) {
    return fallbacks.focusQuestions;
  }
  return name || fallbacks.focusQuestions;
}

export function pickerChildLabel(
  group: ReviewPickerGroup,
  child: ReviewPickerChild,
  fallbacks: { courseContent: string; focusQuestions: string }
): string {
  if (child.kind === "module") {
    const name = (child.fileName || "").trim();
    if (name && group.courseTitle && name !== group.courseTitle) return name;
    return fallbacks.courseContent;
  }
  return child.fileName || fallbacks.focusQuestions;
}

/**
 * Map checked leaf ids onto `/api/srs/session` query params.
 *
 * - Full course (every child checked): material UUIDs + note buckets in
 *   `materialIds`. `noteIds` omitted when every note child is selected so
 *   attached focus cards stay included via the note buckets.
 * - Module child only: `materialIds` = course material, `noteIds` = [] so
 *   sibling notes' cards that share that material_id are excluded.
 * - One note child: `materialIds` = `note:{uuid}`, `noteIds` = [uuid].
 */
export function pickerSelectionToSessionParams(
  groups: ReviewPickerGroup[],
  selectedLeafIds: Set<string>
): { materialIds: string[]; noteIds?: string[] } {
  const materialIds: string[] = [];
  const noteIds: string[] = [];
  let needsEmptyNoteFilter = false;

  for (const group of groups) {
    const selected = group.leafIds.filter((id) => selectedLeafIds.has(id));
    if (selected.length === 0) continue;

    for (const id of selected) {
      materialIds.push(id);
      const noteId = parseNotesFocusBucketNoteId(id);
      if (noteId) noteIds.push(noteId);
    }

    const noteChildren = group.children.filter((c) => c.kind === "note");
    if (noteChildren.length === 0) continue;

    const selectedNotes = noteChildren.filter((c) => selectedLeafIds.has(c.id));
    const selectedModule = group.children.some(
      (c) => c.kind === "module" && selectedLeafIds.has(c.id)
    );
    if (selectedNotes.length < noteChildren.length) {
      if (selectedModule && selectedNotes.length === 0) {
        needsEmptyNoteFilter = true;
      }
    }
  }

  const uniqueMaterialIds = [...new Set(materialIds)];
  const uniqueNoteIds = [...new Set(noteIds)];
  if (needsEmptyNoteFilter || uniqueNoteIds.length > 0) {
    // Always send noteIds when a subset of notes is in play (including
    // module-only, where the list is empty) so the session can distinguish
    // "all personal cards on this material" from "only these notes".
    const subset =
      needsEmptyNoteFilter ||
      groups.some((group) => {
        const noteChildren = group.children.filter((c) => c.kind === "note");
        if (noteChildren.length === 0) return false;
        const involved = group.leafIds.some((id) => selectedLeafIds.has(id));
        if (!involved) return false;
        return noteChildren.some((c) => !selectedLeafIds.has(c.id));
      });
    if (subset) {
      return { materialIds: uniqueMaterialIds, noteIds: uniqueNoteIds };
    }
  }

  return { materialIds: uniqueMaterialIds };
}

export function selectedGroupCount(
  groups: ReviewPickerGroup[],
  selectedLeafIds: Set<string>
): number {
  return groups.filter((g) => g.leafIds.some((id) => selectedLeafIds.has(id)))
    .length;
}

export function visibleDueForLeaves(
  groups: ReviewPickerGroup[],
  selectedLeafIds: Set<string>,
  kind: "both" | "module" | "personal"
): number {
  let n = 0;
  for (const group of groups) {
    const leaves =
      group.children.length > 0
        ? group.children
        : [
            {
              id: group.id,
              module: group.module,
              personal: group.personal,
              total: group.total,
            },
          ];
    for (const leaf of leaves) {
      if (!selectedLeafIds.has(leaf.id)) continue;
      if (kind === "module") n += leaf.module;
      else if (kind === "personal") n += leaf.personal;
      else n += leaf.total;
    }
  }
  return n;
}

export type ReviewDeleteItem = {
  materialId: string;
  courseId: string | null;
};

export function deleteItemsForSelection(
  groups: ReviewPickerGroup[],
  selectedLeafIds: Set<string>
): ReviewDeleteItem[] {
  const items: ReviewDeleteItem[] = [];
  for (const group of groups) {
    for (const leafId of group.leafIds) {
      if (!selectedLeafIds.has(leafId)) continue;
      const child = group.children.find((c) => c.id === leafId);
      items.push({
        materialId: leafId,
        courseId: child?.courseId ?? group.courseId,
      });
    }
  }
  return items;
}

/** Adapter for practice-scope rows that use moduleQuestions naming. */
export function practiceScopeToPickerSource(row: {
  materialId: string;
  fileName: string;
  courseId: string | null;
  courseTitle: string | null;
  moduleQuestions: number;
  personalQuestions: number;
  total: number;
  notes?: SrsDueNoteChild[];
  sectionId?: string | null;
  sectionTitle?: string | null;
  hubKind?: NotesHubKind | null;
}): ReviewPickerSource {
  return {
    materialId: row.materialId,
    fileName: row.fileName,
    courseId: row.courseId,
    courseTitle: row.courseTitle,
    module: row.moduleQuestions,
    personal: row.personalQuestions,
    total: row.total,
    notes: row.notes,
    sectionId: row.sectionId,
    sectionTitle: row.sectionTitle,
    hubKind: row.hubKind,
  };
}

export function asPickerSources(
  rows: SrsDueByMaterial[]
): ReviewPickerSource[] {
  return rows;
}
