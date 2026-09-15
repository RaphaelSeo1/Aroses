import assert from "node:assert/strict";
import test from "node:test";
import {
  allPickerLeafIds,
  groupReviewPickerRows,
  pickerChildLabel,
  pickerParentLabel,
  pickerSelectionToSessionParams,
  type ReviewPickerSource,
} from "./review-picker.ts";

const COURSE = "11111111-1111-4111-8111-111111111111";
const MAT = "22222222-2222-4222-8222-222222222222";
const NOTE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NOTE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function courseWithTwoNotes(overrides?: Partial<ReviewPickerSource>): ReviewPickerSource {
  return {
    materialId: MAT,
    fileName: "Biology.pdf",
    courseId: COURSE,
    courseTitle: "Biology 101",
    module: 8,
    personal: 5,
    total: 13,
    notes: [
      {
        materialId: `note:${NOTE_A}`,
        sourceNoteId: NOTE_A,
        fileName: "Lecture 2",
        personal: 3,
        total: 3,
      },
      {
        materialId: `note:${NOTE_B}`,
        sourceNoteId: NOTE_B,
        fileName: "Office hours",
        personal: 2,
        total: 2,
      },
    ],
    ...overrides,
  };
}

test("groups course as parent with module + note-title children", () => {
  const groups = groupReviewPickerRows([courseWithTwoNotes()]);
  assert.equal(groups.length, 1);
  const g = groups[0]!;
  assert.equal(g.courseTitle, "Biology 101");
  assert.equal(g.children.length, 3);
  assert.equal(g.children[0]!.kind, "module");
  assert.equal(g.children[0]!.id, MAT);
  assert.deepEqual(
    g.children.filter((c) => c.kind === "note").map((c) => c.fileName),
    ["Lecture 2", "Office hours"]
  );
  assert.equal(
    pickerParentLabel(g, { focusQuestions: "Focus questions", courseFallback: "Course" }),
    "Biology 101"
  );
  assert.equal(
    pickerChildLabel(g, g.children.find((c) => c.kind === "note")!, {
      courseContent: "Course content",
      focusQuestions: "Focus questions",
    }),
    "Lecture 2"
  );
});

test("notes-only course (no module) has only note children under the course name", () => {
  const groups = groupReviewPickerRows([
    {
      materialId: `note:${NOTE_A}`,
      fileName: "Lecture 2",
      courseId: COURSE,
      courseTitle: "Biology 101",
      module: 0,
      personal: 4,
      total: 4,
    },
    {
      materialId: `note:${NOTE_B}`,
      fileName: "Office hours",
      courseId: COURSE,
      courseTitle: "Biology 101",
      module: 0,
      personal: 1,
      total: 1,
    },
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]!.courseTitle, "Biology 101");
  assert.equal(groups[0]!.children.every((c) => c.kind === "note"), true);
  assert.equal(groups[0]!.children.length, 2);
});

test("folds notes-only buckets into an existing course material parent", () => {
  const groups = groupReviewPickerRows([
    {
      materialId: MAT,
      fileName: "Biology.pdf",
      courseId: COURSE,
      courseTitle: "Biology 101",
      module: 2,
      personal: 0,
      total: 2,
    },
    {
      materialId: `note:${NOTE_A}`,
      fileName: "Lecture 2",
      courseId: COURSE,
      courseTitle: "Biology 101",
      module: 0,
      personal: 3,
      total: 3,
    },
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]!.total, 5);
  assert.equal(groups[0]!.children.some((c) => c.id === `note:${NOTE_A}`), true);
});

test("standalone note without a course is a single row labeled with the note title", () => {
  const groups = groupReviewPickerRows([
    {
      materialId: `note:${NOTE_A}`,
      fileName: "Chem recap",
      courseId: null,
      courseTitle: null,
      module: 0,
      personal: 3,
      total: 3,
    },
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]!.children.length, 0);
  assert.equal(groups[0]!.id, `note:${NOTE_A}`);
  assert.equal(
    pickerParentLabel(groups[0]!, {
      focusQuestions: "Focus questions",
      courseFallback: "Course",
    }),
    "Chem recap"
  );
});

test("legacy notes bucket without a note id is Focus questions", () => {
  const groups = groupReviewPickerRows([
    {
      materialId: "notes",
      fileName: "Focus questions",
      courseId: null,
      courseTitle: null,
      module: 0,
      personal: 2,
      total: 2,
    },
  ]);
  assert.equal(groups.length, 1);
  assert.equal(
    pickerParentLabel(groups[0]!, {
      focusQuestions: "Focus questions",
      courseFallback: "Course",
    }),
    "Focus questions"
  );
});

test("orphan notes bucket with source_label Lecture 2 keeps that title", () => {
  const groups = groupReviewPickerRows([
    {
      materialId: "notes",
      fileName: "Lecture 2",
      courseId: null,
      courseTitle: null,
      module: 0,
      personal: 49,
      total: 49,
    },
  ]);
  assert.equal(
    pickerParentLabel(groups[0]!, {
      focusQuestions: "Focus questions",
      courseFallback: "Course",
    }),
    "Lecture 2"
  );
});

test("Lecture 2 notes-origin child sits under PBHLTH, not a course PDF", () => {
  const groups = groupReviewPickerRows([
    {
      materialId: MAT,
      fileName: "Telomeres, centromeres and chromosome substructure.pdf",
      courseId: COURSE,
      courseTitle: "MCB 104 (Fall 2026)",
      module: 8,
      personal: 0,
      total: 8,
    },
    {
      materialId: `note:${NOTE_A}`,
      fileName: "Lecture 2",
      courseId: "44444444-4444-4444-8444-444444444444",
      courseTitle: "PBHLTH 162A",
      module: 0,
      personal: 49,
      total: 49,
    },
  ]);
  assert.equal(groups.length, 2);
  const pbhlth = groups.find((g) => g.courseTitle === "PBHLTH 162A")!;
  const mcb = groups.find((g) => g.courseTitle === "MCB 104 (Fall 2026)")!;
  assert.equal(pbhlth.children.length, 1);
  assert.equal(pbhlth.children[0]!.kind, "note");
  assert.equal(pbhlth.children[0]!.fileName, "Lecture 2");
  assert.equal(mcb.children.every((c) => c.kind === "module"), true);
  assert.equal(
    pickerParentLabel(pbhlth, {
      focusQuestions: "Focus questions",
      courseFallback: "Course",
    }),
    "PBHLTH 162A"
  );
});

test("full course selection passes material + note buckets without noteIds param", () => {
  const groups = groupReviewPickerRows([courseWithTwoNotes()]);
  const selected = new Set(allPickerLeafIds(groups));
  const params = pickerSelectionToSessionParams(groups, selected);
  assert.deepEqual(new Set(params.materialIds), new Set([MAT, `note:${NOTE_A}`, `note:${NOTE_B}`]));
  assert.equal("noteIds" in params, false);
});

test("selecting one note child passes that note bucket and noteIds", () => {
  const groups = groupReviewPickerRows([courseWithTwoNotes()]);
  const params = pickerSelectionToSessionParams(
    groups,
    new Set([`note:${NOTE_A}`])
  );
  assert.deepEqual(params.materialIds, [`note:${NOTE_A}`]);
  assert.deepEqual(params.noteIds, [NOTE_A]);
});

test("module child only sends empty noteIds so sibling notes are excluded", () => {
  const groups = groupReviewPickerRows([courseWithTwoNotes()]);
  const params = pickerSelectionToSessionParams(groups, new Set([MAT]));
  assert.deepEqual(params.materialIds, [MAT]);
  assert.deepEqual(params.noteIds, []);
});
