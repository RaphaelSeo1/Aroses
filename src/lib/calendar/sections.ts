import type { CalendarItem, CalendarTodoSection } from "@/types/calendar";

export const CALENDAR_SECTION_TITLE_MAX = 80;
export const CALENDAR_SECTIONS_MAX = 30;

export const CALENDAR_SECTIONS_SELECT =
  "id, title, sort_order, created_at";

type SectionRow = {
  id: string;
  title: string;
  sort_order: number | null;
  created_at: string;
};

export function mapSectionRow(row: SectionRow): CalendarTodoSection {
  return {
    id: row.id,
    title: row.title,
    sortOrder: typeof row.sort_order === "number" ? row.sort_order : 0,
    createdAt: row.created_at,
  };
}

export function parseSectionTitle(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const title = raw.replace(/\s+/g, " ").trim().slice(0, CALENDAR_SECTION_TITLE_MAX);
  return title || null;
}

export type TodoSectionGroup = {
  section: CalendarTodoSection | null;
  items: CalendarItem[];
};

export function groupTodosBySection(
  items: CalendarItem[],
  sections: CalendarTodoSection[]
): TodoSectionGroup[] {
  const bySection = new Map<string | null, CalendarItem[]>();
  bySection.set(null, []);
  for (const section of sections) {
    bySection.set(section.id, []);
  }
  for (const item of items) {
    const key =
      item.sectionId && bySection.has(item.sectionId) ? item.sectionId : null;
    bySection.get(key)!.push(item);
  }
  return [
    { section: null, items: bySection.get(null) ?? [] },
    ...sections.map((section) => ({
      section,
      items: bySection.get(section.id) ?? [],
    })),
  ];
}
