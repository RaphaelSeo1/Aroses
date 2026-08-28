import assert from "node:assert/strict";
import test from "node:test";
import { resolveNextLecture } from "./resolve-next-lecture";

test("next module in the same material is the next lecture", () => {
  const result = resolveNextLecture({
    materialId: "m1",
    moduleIds: [1, 2, 3],
    activeModuleId: 1,
    sidebar: [{ materialId: "m1", moduleIds: [1, 2, 3] }],
  });
  assert.deepEqual(result, {
    kind: "lecture",
    target: { materialId: "m1", moduleId: 2 },
  });
});

test("last module advances to the next material in the same section", () => {
  const result = resolveNextLecture({
    materialId: "m1",
    moduleIds: [1, 2],
    activeModuleId: 2,
    sidebar: [
      { materialId: "m1", moduleIds: [1, 2], examGroupId: "midterm" },
      { materialId: "m2", moduleIds: [10], examGroupId: "midterm" },
    ],
  });
  assert.deepEqual(result, {
    kind: "lecture",
    target: { materialId: "m2", moduleId: 10 },
  });
});

test("does not cross exam groups — section is done", () => {
  const result = resolveNextLecture({
    materialId: "m1",
    moduleIds: [1],
    activeModuleId: 1,
    sidebar: [
      { materialId: "m1", moduleIds: [1], examGroupId: "midterm" },
      { materialId: "m2", moduleIds: [10], examGroupId: "final" },
    ],
  });
  assert.equal(result.kind, "section_done");
});

test("last material in the course is course_done", () => {
  const result = resolveNextLecture({
    materialId: "m2",
    moduleIds: [10],
    activeModuleId: 10,
    sidebar: [
      { materialId: "m1", moduleIds: [1], examGroupId: "midterm" },
      { materialId: "m2", moduleIds: [10], examGroupId: "final" },
    ],
  });
  assert.equal(result.kind, "course_done");
});

test("ungrouped materials stay in one sequence", () => {
  const result = resolveNextLecture({
    materialId: "m1",
    moduleIds: [1],
    activeModuleId: 1,
    sidebar: [
      { materialId: "m1", moduleIds: [1] },
      { materialId: "m2", moduleIds: [4, 5] },
    ],
  });
  assert.deepEqual(result, {
    kind: "lecture",
    target: { materialId: "m2", moduleId: 4 },
  });
});
