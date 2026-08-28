import assert from "node:assert/strict";
import test from "node:test";
import { groupTodosBySection, parseSectionTitle } from "./sections";
import type { CalendarItem, CalendarTodoSection } from "@/types/calendar";

function todo(
  id: string,
  title: string,
  sectionId: string | null = null
): CalendarItem {
  return {
    id,
    title,
    notes: "",
    kind: "todo",
    startsAt: null,
    endsAt: null,
    allDay: true,
    important: false,
    completedAt: null,
    sectionId,
    createdAt: "",
    updatedAt: "",
  };
}

test("parseSectionTitle trims and caps length", () => {
  assert.equal(parseSectionTitle("  Chem  "), "Chem");
  assert.equal(parseSectionTitle("   "), null);
  assert.equal(parseSectionTitle(1), null);
  assert.equal(parseSectionTitle("x".repeat(90))?.length, 80);
});

test("groupTodosBySection keeps empty sections and inbox", () => {
  const sections: CalendarTodoSection[] = [
    { id: "s1", title: "Chem", sortOrder: 0, createdAt: "" },
    { id: "s2", title: "Personal", sortOrder: 1, createdAt: "" },
  ];
  const groups = groupTodosBySection(
    [
      todo("a", "Lab report", "s1"),
      todo("b", "Groceries", null),
      todo("c", "Orphan", "missing"),
    ],
    sections
  );
  assert.equal(groups.length, 3);
  assert.equal(groups[0]?.section, null);
  assert.deepEqual(
    groups[0]?.items.map((i) => i.id),
    ["b", "c"]
  );
  assert.equal(groups[1]?.section?.title, "Chem");
  assert.deepEqual(
    groups[1]?.items.map((i) => i.id),
    ["a"]
  );
  assert.equal(groups[2]?.items.length, 0);
});
