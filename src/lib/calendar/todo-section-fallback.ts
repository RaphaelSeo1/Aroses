import type { CalendarItem, CalendarTodoSection } from "@/types/calendar";

/**
 * Production may not have migration 107 yet. Until `user_calendar_todo_sections`
 * exists, named to-do groups are stored as hidden rows in `user_calendar_items`
 * whose notes start with this marker.
 */
export const TODO_SECTION_FALLBACK_MARK = "aroses.todo-section:";

type FallbackPayload = {
  o: number;
  ids: string[];
};

export function isTodoSectionFallbackNotes(notes: string): boolean {
  return notes.startsWith(TODO_SECTION_FALLBACK_MARK);
}

export function isTodoSectionFallbackItem(item: CalendarItem): boolean {
  return isTodoSectionFallbackNotes(item.notes);
}

export function encodeTodoSectionFallbackNotes(input: {
  sortOrder: number;
  itemIds: string[];
}): string {
  const payload: FallbackPayload = {
    o: input.sortOrder,
    ids: input.itemIds.filter((id) => typeof id === "string" && id.length > 0),
  };
  return `${TODO_SECTION_FALLBACK_MARK}${JSON.stringify(payload)}`;
}

export function parseTodoSectionFallbackNotes(notes: string): {
  sortOrder: number;
  itemIds: string[];
} | null {
  if (!isTodoSectionFallbackNotes(notes)) return null;
  try {
    const raw = JSON.parse(notes.slice(TODO_SECTION_FALLBACK_MARK.length)) as {
      o?: unknown;
      ids?: unknown;
    };
    const ids = Array.isArray(raw.ids)
      ? raw.ids.filter((id): id is string => typeof id === "string" && id.length > 0)
      : [];
    return {
      sortOrder: typeof raw.o === "number" && Number.isFinite(raw.o) ? raw.o : 0,
      itemIds: ids,
    };
  } catch {
    return { sortOrder: 0, itemIds: [] };
  }
}

export function splitTodoSectionFallback(items: CalendarItem[]): {
  items: CalendarItem[];
  sections: CalendarTodoSection[];
} {
  const sections: CalendarTodoSection[] = [];
  const membership = new Map<string, string>();
  const visible: CalendarItem[] = [];

  for (const item of items) {
    const parsed = parseTodoSectionFallbackNotes(item.notes);
    if (!parsed) {
      visible.push(item);
      continue;
    }
    sections.push({
      id: item.id,
      title: item.title,
      sortOrder: parsed.sortOrder,
      createdAt: item.createdAt,
    });
    for (const id of parsed.itemIds) {
      if (!membership.has(id)) membership.set(id, item.id);
    }
  }

  sections.sort(
    (a, b) =>
      a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt)
  );

  return {
    sections,
    items: visible.map((item) => ({
      ...item,
      sectionId: item.sectionId ?? membership.get(item.id) ?? null,
    })),
  };
}
