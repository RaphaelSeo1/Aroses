import assert from "node:assert/strict";
import test from "node:test";
import type { CalendarItem } from "@/types/calendar";
import {
  encodeTodoSectionFallbackNotes,
  isTodoSectionFallbackNotes,
  parseTodoSectionFallbackNotes,
  splitTodoSectionFallback,
} from "./todo-section-fallback";

function item(
  id: string,
  title: string,
  notes: string,
  sectionId: string | null = null
): CalendarItem {
  return {
    id,
    title,
    notes,
    kind: "todo",
    startsAt: null,
    endsAt: null,
    allDay: true,
    important: false,
    completedAt: null,
    sectionId,
    createdAt: "2026-08-28T00:00:00.000Z",
    updatedAt: "2026-08-28T00:00:00.000Z",
  };
}

test("fallback notes round-trip", () => {
  const notes = encodeTodoSectionFallbackNotes({
    sortOrder: 2,
    itemIds: ["a", "b"],
  });
  assert.equal(isTodoSectionFallbackNotes(notes), true);
  assert.deepEqual(parseTodoSectionFallbackNotes(notes), {
    sortOrder: 2,
    itemIds: ["a", "b"],
  });
});

test("splitTodoSectionFallback hides section rows and overlays membership", () => {
  const chem = encodeTodoSectionFallbackNotes({
    sortOrder: 0,
    itemIds: ["t1"],
  });
  const { items, sections } = splitTodoSectionFallback([
    item("sec", "Chem", chem),
    item("t1", "Lab report", ""),
    item("t2", "Groceries", ""),
  ]);
  assert.deepEqual(
    sections.map((s) => s.title),
    ["Chem"]
  );
  assert.equal(items.length, 2);
  assert.equal(items.find((i) => i.id === "t1")?.sectionId, "sec");
  assert.equal(items.find((i) => i.id === "t2")?.sectionId, null);
});
