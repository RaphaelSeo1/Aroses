import assert from "node:assert/strict";
import test from "node:test";
import {
  stripColumnFromRows,
  stripSourceColumns,
} from "./personal-quiz-insert";

test("stripColumnFromRows drops only the named key", () => {
  const rows = [
    { material_id: "a", source_label: "Notes", item: { q: 1 } },
  ];
  const next = stripColumnFromRows(rows, "source_label");
  assert.deepEqual(next, [{ material_id: "a", item: { q: 1 } }]);
  assert.equal("source_label" in rows[0]!, true);
});

test("stripSourceColumns drops all migration-106 fields", () => {
  const rows = [
    {
      user_id: "u",
      material_id: null,
      module_id: null,
      item: { type: "mcq" },
      source_note_id: "n",
      source_excerpt: "hi",
      source_label: "Notes",
    },
  ];
  const next = stripSourceColumns(rows);
  assert.deepEqual(next, [
    {
      user_id: "u",
      material_id: null,
      module_id: null,
      item: { type: "mcq" },
    },
  ]);
});
