import type { NoteHubSection } from "@/lib/notes/hub-types";
import { isCustomSection } from "@/lib/notes/hub-types";

export const BUILTIN_HUB_SECTION_IDS = [
  "standalone",
  "live",
  "tutor",
  "course",
] as const;

export function isValidSectionOrder(
  order: string[],
  allowed: Set<string>
): boolean {
  if (order.length === 0 || order.length !== allowed.size) return false;
  const seen = new Set<string>();
  for (const id of order) {
    if (!allowed.has(id) || seen.has(id)) return false;
    seen.add(id);
  }
  return true;
}

/** Apply a saved order; append any sections missing from the saved list. */
export function applySectionOrder(
  sections: NoteHubSection[],
  order: string[]
): NoteHubSection[] {
  if (!order.length) return sections;

  const byId = new Map(sections.map((s) => [s.id, s]));
  const seen = new Set<string>();
  const result: NoteHubSection[] = [];

  for (const id of order) {
    const section = byId.get(id);
    if (section && !seen.has(id)) {
      result.push(section);
      seen.add(id);
    }
  }

  for (const section of sections) {
    if (!seen.has(section.id)) {
      result.push(section);
    }
  }

  return result;
}

export function reorderSectionsByIds(
  sections: NoteHubSection[],
  orderedIds: string[]
): NoteHubSection[] {
  const byId = new Map(sections.map((s) => [s.id, s]));
  return orderedIds
    .map((id) => byId.get(id))
    .filter((s): s is NoteHubSection => Boolean(s));
}

export function sectionAcceptsNoteDrop(section: NoteHubSection): boolean {
  return section.id === "standalone" || isCustomSection(section);
}
