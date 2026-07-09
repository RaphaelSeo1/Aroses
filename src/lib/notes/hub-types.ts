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

export function noteDragId(key: string) {
  return `${NOTE_DRAG_PREFIX}${key}`;
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
  dateLabel: string;
  isLive?: boolean;
  chip?: { label: string; tone: "live" | "paused" | "done" | "failed" };
  ref?: NoteHubRef;
  /** When false, card cannot be bulk-deleted. */
  deletable?: boolean;
};
