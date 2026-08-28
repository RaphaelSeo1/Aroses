import assert from "node:assert/strict";
import test from "node:test";
import { parseCalendarInput, parseCalendarPatch, toInsertRow } from "./items";

test("parseCalendarInput keeps a section id", () => {
  const input = parseCalendarInput({
    title: "Lab report",
    kind: "todo",
    sectionId: "11111111-1111-4111-8111-111111111111",
  });
  assert.equal(input?.title, "Lab report");
  assert.equal(input?.sectionId, "11111111-1111-4111-8111-111111111111");
});

test("parseCalendarPatch can clear a section", () => {
  const patch = parseCalendarPatch({ sectionId: null });
  assert.equal(patch?.sectionId, null);
});

test("toInsertRow omits section_id unless provided", () => {
  const without = toInsertRow("user-1", { title: "Task" });
  assert.equal("section_id" in without, false);
  const withSection = toInsertRow("user-1", {
    title: "Task",
    sectionId: "11111111-1111-4111-8111-111111111111",
  });
  assert.equal(
    withSection.section_id,
    "11111111-1111-4111-8111-111111111111"
  );
});
