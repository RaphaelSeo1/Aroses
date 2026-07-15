/** Typed reference for bulk actions on the Notes hub (delete, etc.). */
export type NoteHubRef =
  | { kind: "standalone"; id: string }
  | { kind: "tutor"; id: string }
  | { kind: "live"; id: string }
  | { kind: "course"; materialId: string };

export type NoteHubSection = {
  id: string;
  title: string;
  hint: string;
  cards: NoteDocCardData[];
  /** User-created folder for standalone notes. */
  custom?: boolean;
  /** Section emoji icon (custom folders + optional built-in overrides). */
  emoji?: string | null;
};

export const CUSTOM_SECTION_PREFIX = "custom:" as const;

export function customSectionId(uuid: string): string {
  return `${CUSTOM_SECTION_PREFIX}${uuid}`;
}

export function parseCustomSectionId(id: string): string | null {
  return id.startsWith(CUSTOM_SECTION_PREFIX)
    ? id.slice(CUSTOM_SECTION_PREFIX.length)
    : null;
}

export function isCustomSection(section: Pick<NoteHubSection, "id" | "custom">): boolean {
  return section.custom === true || parseCustomSectionId(section.id) !== null;
}

export const NOTE_DRAG_PREFIX = "note:";
export const SECTION_DRAG_PREFIX = "section:";
export const DROP_PREFIX = "drop:";

/** Unique drag id per list location so the same note can appear in My notes + a folder. */
export function noteDragId(key: string, scope = "main") {
  return `${NOTE_DRAG_PREFIX}${scope}::${key}`;
}

export function parseNoteDragCardKey(dragId: string): string | null {
  if (!dragId.startsWith(NOTE_DRAG_PREFIX)) return null;
  const rest = dragId.slice(NOTE_DRAG_PREFIX.length);
  const sep = rest.indexOf("::");
  if (sep >= 0) return rest.slice(sep + 2) || null;
  return rest || null;
}

export function sectionDragId(sectionId: string) {
  return `${SECTION_DRAG_PREFIX}${sectionId}`;
}

export function dropTargetId(sectionId: string) {
  return `${DROP_PREFIX}${sectionId}`;
}

export function resolveSectionSortTarget(overId: string): string | null {
  if (overId.startsWith(SECTION_DRAG_PREFIX)) {
    return overId.slice(SECTION_DRAG_PREFIX.length) || null;
  }
  if (overId.startsWith(DROP_PREFIX)) {
    return overId.slice(DROP_PREFIX.length) || null;
  }
  return null;
}

export function resolveDropSectionId(overId: string): string | null {
  if (overId.startsWith(DROP_PREFIX)) return overId.slice(DROP_PREFIX.length);
  if (overId.startsWith(SECTION_DRAG_PREFIX)) {
    return overId.slice(SECTION_DRAG_PREFIX.length);
  }
  return null;
}

export function sectionAcceptsNoteDrop(sectionId: string): boolean {
  return sectionId === "standalone" || parseCustomSectionId(sectionId) !== null;
}

export function dropSectionToMoveTarget(
  sectionId: string
): string | null | undefined {
  if (sectionId === "standalone") return null;
  const uuid = parseCustomSectionId(sectionId);
  if (uuid) return uuid;
  return undefined;
}

export type NoteDocCardData = {
  key: string;
  href: string;
  title: string;
  subtitle?: string | null;
  preview?: string | null;
  /** Full-ish plain text for keyword search (not shown in the card UI). */
  searchText?: string;
  dateLabel: string;
  isLive?: boolean;
  chip?: { label: string; tone: "live" | "paused" | "done" | "failed" };
  ref?: NoteHubRef;
  /** When false, card cannot be bulk-deleted. */
  deletable?: boolean;
  /** Custom folder uuid if this note currently lives in one. */
  folderSectionId?: string | null;
  /** Soft-deleted note in Recently deleted. */
  trashed?: boolean;
};

const FOLDER_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Stable hub card key for a typed note ref (used by note_folders map). */
export function cardKeyForRef(ref: NoteHubRef): string {
  switch (ref.kind) {
    case "standalone":
      return `standalone-${ref.id}`;
    case "live":
      return `live-${ref.id}`;
    case "tutor":
      return `tutor-${ref.id}`;
    case "course":
      return `course-${ref.materialId}`;
  }
}

export function parseNoteFolders(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string" && FOLDER_UUID_RE.test(value)) {
      out[key] = value;
    }
  }
  return out;
}
