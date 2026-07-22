import assert from "node:assert/strict";
import test from "node:test";
import type { CourseModule } from "@/types/course";
import {
  applyLessonEditOps,
  coerceLessonEditOps,
  locateSpan,
  previewLocations,
} from "./refine-lesson-ops";

function mod(
  contents: string[],
  extras?: { key_terms?: { term: string; definition: string }[]; examples?: string[] }[]
): CourseModule {
  return {
    id: 1,
    title: "M",
    lessons: contents.map((content, i) => ({
      title: `L${i}`,
      content,
      key_terms: extras?.[i]?.key_terms ?? [],
      examples: extras?.[i]?.examples ?? [],
    })),
  } as unknown as CourseModule;
}

test("delete removes only the matched span and preserves the rest", () => {
  const m = mod(["Alpha. Beta. Gamma."]);
  const { module, changes } = applyLessonEditOps(m, [
    { lessonIndex: 0, find: " Beta.", replace: "" },
  ]);
  assert.equal(module.lessons[0].content, "Alpha. Gamma.");
  assert.deepEqual(changes, [
    { lessonIndex: 0, start: 6, deleteLen: 6, insert: "" },
  ]);
});

test("replace swaps only the matched span", () => {
  const m = mod(["The cat sat."]);
  const { module, changes } = applyLessonEditOps(m, [
    { lessonIndex: 0, find: "cat", replace: "dog" },
  ]);
  assert.equal(module.lessons[0].content, "The dog sat.");
  assert.deepEqual(changes, [
    { lessonIndex: 0, start: 4, deleteLen: 3, insert: "dog" },
  ]);
});

test("insert at end appends with spacing and correct offset", () => {
  const m = mod(["Body text."]);
  const { module, changes } = applyLessonEditOps(m, [
    { lessonIndex: 0, insert: "end", text: "New line." },
  ]);
  assert.equal(module.lessons[0].content, "Body text.\n\nNew line.");
  assert.equal(changes[0].start, "Body text.".length);
  assert.equal(changes[0].deleteLen, 0);
  assert.equal(changes[0].insert, "\n\nNew line.");
});

test("unmatched find is skipped, not a rewrite", () => {
  const m = mod(["Untouched content."]);
  const { module, changes, structuredTouched } = applyLessonEditOps(m, [
    { lessonIndex: 0, find: "not present", replace: "x" },
  ]);
  assert.equal(module.lessons[0].content, "Untouched content.");
  assert.equal(changes.length, 0);
  assert.equal(structuredTouched, 0);
});

test("sequential ops carry offsets valid at application time", () => {
  const m = mod(["one two three"]);
  const { module, changes } = applyLessonEditOps(m, [
    { lessonIndex: 0, find: "one ", replace: "" },
    { lessonIndex: 0, find: "three", replace: "3" },
  ]);
  assert.equal(module.lessons[0].content, "two 3");
  assert.deepEqual(changes, [
    { lessonIndex: 0, start: 0, deleteLen: 4, insert: "" },
    { lessonIndex: 0, start: 4, deleteLen: 5, insert: "3" },
  ]);
});

test("locateSpan tolerates whitespace differences", () => {
  const span = locateSpan("hello   world here", "hello world");
  assert.deepEqual(span, { index: 0, length: "hello   world".length });
});

test("previewLocations reports content spans with kind", () => {
  const m = mod(["one two three four"]);
  const locs = previewLocations(m, [
    { lessonIndex: 0, find: "three", replace: "3" },
    { lessonIndex: 0, find: "one ", replace: "" },
  ]);
  assert.deepEqual(locs, [
    {
      lessonIndex: 0,
      kind: "content",
      start: 8,
      deleteLen: 5,
      insert: "3",
    },
    {
      lessonIndex: 0,
      kind: "content",
      start: 0,
      deleteLen: 4,
      insert: "",
    },
  ]);
});

test("previewLocations skips ops whose find is absent", () => {
  const m = mod(["hello world"]);
  const locs = previewLocations(m, [
    { lessonIndex: 0, find: "nope", replace: "x" },
    { lessonIndex: 0, insert: "end", text: "!" },
  ]);
  assert.deepEqual(locs, [
    {
      lessonIndex: 0,
      kind: "content",
      start: "hello world".length,
      deleteLen: 0,
      insert: "!",
    },
  ]);
});

test("addKeyTerm appends without touching lesson content", () => {
  const m = mod(["Body stays."], [
    { key_terms: [{ term: "Old", definition: "def" }] },
  ]);
  const { module, changes, structuredTouched } = applyLessonEditOps(m, [
    {
      lessonIndex: 0,
      addKeyTerm: { term: "Secular trend", definition: "Long-term change." },
    },
  ]);
  assert.equal(module.lessons[0].content, "Body stays.");
  assert.equal(changes.length, 0);
  assert.equal(structuredTouched, 1);
  assert.equal(module.lessons[0].key_terms.length, 2);
  assert.equal(module.lessons[0].key_terms[1].term, "Secular trend");
});

test("removeKeyTerm does not rewrite content", () => {
  const m = mod(["Body."], [
    {
      key_terms: [
        { term: "Keep", definition: "yes" },
        { term: "Drop", definition: "no" },
      ],
    },
  ]);
  const { module, structuredTouched } = applyLessonEditOps(m, [
    { lessonIndex: 0, removeKeyTerm: "Drop" },
  ]);
  assert.equal(module.lessons[0].content, "Body.");
  assert.equal(structuredTouched, 1);
  assert.deepEqual(module.lessons[0].key_terms, [
    { term: "Keep", definition: "yes" },
  ]);
});

test("previewLocations reports key_term markers", () => {
  const m = mod(["Body."]);
  const locs = previewLocations(m, [
    {
      lessonIndex: 0,
      addKeyTerm: { term: "X", definition: "Y" },
    },
  ]);
  assert.deepEqual(locs, [
    {
      lessonIndex: 0,
      kind: "key_term",
      action: "add",
      term: "X",
      definition: "Y",
    },
  ]);
});

test("coerceLessonEditOps accepts structured key term ops", () => {
  const ops = coerceLessonEditOps({
    ops: [
      {
        lessonIndex: 0,
        addKeyTerm: { term: "A", definition: "B" },
      },
      { lessonIndex: 1, remove_key_term: "Old" },
      { lessonIndex: 2 }, // not actionable
    ],
  });
  assert.deepEqual(ops, [
    {
      lessonIndex: 0,
      addKeyTerm: { term: "A", definition: "B" },
    },
    { lessonIndex: 1, removeKeyTerm: "Old" },
  ]);
});

test("coerceLessonEditOps accepts {ops:[...]} and filters junk", () => {
  const ops = coerceLessonEditOps({
    ops: [
      { lessonIndex: 0, find: "x", replace: "y" },
      { lessonIndex: "1", insert: "end", text: "hi" },
      { lessonIndex: 2 }, // not actionable
      { nope: true },
    ],
  });
  assert.deepEqual(ops, [
    { lessonIndex: 0, find: "x", replace: "y" },
    { lessonIndex: 1, insert: "end", text: "hi" },
  ]);
});
