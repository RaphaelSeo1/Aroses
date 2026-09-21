import assert from "node:assert/strict";
import test from "node:test";
import {
  addPersonalFocusCount,
  finalizeFocusBuckets,
} from "./srs-focus-buckets.ts";
import type { NotesFocusBucketMeta } from "./notes/hydrate-notes-focus-buckets.ts";
import type { SrsDueByMaterial } from "./srs-due.ts";
import { notesFocusBucketId } from "./notes/notes-focus-bucket.ts";
import {
  groupReviewPickerRows,
  pickerChildLabel,
  pickerParentLabel,
} from "./review-picker.ts";

const MAT = "22222222-2222-4222-8222-222222222222";
const COURSE = "11111111-1111-4111-8111-111111111111";
const PBHLTH = "44444444-4444-4444-8444-444444444444";
const NOTE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NOTE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const fallbacks = {
  focusQuestions: "Focus questions",
  courseFallback: "Course",
  courseContent: "Course content",
};

test("notes-origin cards with a course stay on the note, not the PDF", () => {
  const byMaterial = new Map<string, SrsDueByMaterial>([
    [
      MAT,
      {
        materialId: MAT,
        fileName: "Telomeres, centromeres and chromosome substructure.pdf",
        courseId: COURSE,
        courseTitle: "MCB 104 (Fall 2026)",
        module: 4,
        personal: 0,
        total: 0,
      },
    ],
  ]);
  const notesMeta = new Map<string, NotesFocusBucketMeta>([
    [
      notesFocusBucketId(NOTE_A),
      {
        fileName: "Lecture 2",
        courseId: PBHLTH,
        courseTitle: "PBHLTH 162A",
        noteDeleted: false,
      },
    ],
  ]);
  for (let i = 0; i < 49; i++) {
    addPersonalFocusCount(
      byMaterial,
      {
        // Even if a legacy row pointed at another course's PDF, keep notes-origin.
        materialId: MAT,
        sourceNoteId: NOTE_A,
        sourceLabel: "Lecture 2",
      },
      notesMeta
    );
  }
  finalizeFocusBuckets(byMaterial);

  const mcb = byMaterial.get(MAT)!;
  assert.equal(mcb.personal, 0);
  assert.equal(mcb.module, 4);
  assert.equal(mcb.notes, undefined);

  const noteBucket = byMaterial.get(notesFocusBucketId(NOTE_A))!;
  assert.equal(noteBucket.fileName, "Lecture 2");
  assert.equal(noteBucket.courseTitle, "PBHLTH 162A");
  assert.equal(noteBucket.personal, 49);

  const groups = groupReviewPickerRows([...byMaterial.values()]);
  const pbhlth = groups.find((g) => g.courseTitle === "PBHLTH 162A");
  const mcbGroup = groups.find((g) => g.courseTitle === "MCB 104 (Fall 2026)");
  assert.ok(pbhlth);
  assert.ok(mcbGroup);
  assert.equal(
    pickerParentLabel(pbhlth!, fallbacks),
    "PBHLTH 162A"
  );
  assert.equal(pbhlth!.children.length, 1);
  assert.equal(pbhlth!.children[0]!.kind, "note");
  assert.equal(pbhlth!.children[0]!.fileName, "Lecture 2");
  assert.equal(
    pickerChildLabel(pbhlth!, pbhlth!.children[0]!, fallbacks),
    "Lecture 2"
  );
  assert.equal(mcbGroup!.children.every((c) => c.kind === "module"), true);
  assert.equal(
    groups.some((g) => pickerParentLabel(g, fallbacks) === "Focus questions"),
    false
  );
});

test("notes-hub Lecture 4 stays out of a same-titled course lecture", () => {
  const sectionId = "55555555-5555-4555-8555-555555555555";
  const byMaterial = new Map<string, SrsDueByMaterial>([
    [
      MAT,
      {
        materialId: MAT,
        fileName: "Lecture 4",
        courseId: COURSE,
        courseTitle: "MCB 104 (Fall 2026)",
        module: 8,
        personal: 0,
        total: 0,
      },
    ],
  ]);
  const notesMeta = new Map<string, NotesFocusBucketMeta>([
    [
      notesFocusBucketId(NOTE_A),
      {
        fileName:
          "Lecture 4 - ER Targeting, Endomembrane Trafficking, and mRNA-to-Protein Flow",
        courseId: null,
        courseTitle: null,
        noteDeleted: false,
        sectionId,
        sectionTitle: "MCB 104 !",
        hubKind: "custom",
      },
    ],
  ]);
  for (let i = 0; i < 32; i++) {
    addPersonalFocusCount(
      byMaterial,
      {
        materialId: null,
        sourceNoteId: NOTE_A,
        sourceLabel:
          "Lecture 4 - ER Targeting, Endomembrane Trafficking, and mRNA-to-Protein Flow",
      },
      notesMeta
    );
  }
  for (let i = 0; i < 16; i++) {
    addPersonalFocusCount(
      byMaterial,
      {
        materialId: MAT,
        sourceNoteId: null,
        sourceLabel: "Lecture 4",
      },
      notesMeta
    );
  }
  finalizeFocusBuckets(byMaterial);

  const courseMat = byMaterial.get(MAT)!;
  assert.equal(courseMat.personal, 16);
  const noteBucket = byMaterial.get(notesFocusBucketId(NOTE_A))!;
  assert.equal(noteBucket.personal, 32);
  assert.equal(noteBucket.sectionId, sectionId);

  const groups = groupReviewPickerRows([...byMaterial.values()]);
  const hub = groups.find((g) => g.id === `section:${sectionId}`);
  const course = groups.find((g) => g.courseTitle === "MCB 104 (Fall 2026)");
  assert.ok(hub);
  assert.ok(course);
  assert.equal(pickerParentLabel(hub!, fallbacks), "MCB 104 !");
  assert.equal(hub!.personal, 32);
  assert.equal(course!.personal, 16);
  assert.equal(course!.children.every((c) => c.kind === "module"), true);
});

test("notes-only cards keep the hub folder they belong to", () => {
  const byMaterial = new Map<string, SrsDueByMaterial>();
  const sectionId = "55555555-5555-4555-8555-555555555555";
  const notesMeta = new Map<string, NotesFocusBucketMeta>([
    [
      notesFocusBucketId(NOTE_A),
      {
        fileName: "Chem recap",
        courseId: null,
        courseTitle: null,
        noteDeleted: false,
        sectionId,
        sectionTitle: "Any folder name",
        hubKind: "custom",
      },
    ],
  ]);
  addPersonalFocusCount(
    byMaterial,
    { materialId: null, sourceNoteId: NOTE_A, sourceLabel: "Chem recap" },
    notesMeta
  );
  finalizeFocusBuckets(byMaterial);
  const bucket = byMaterial.get(notesFocusBucketId(NOTE_A))!;
  assert.equal(bucket.sectionId, sectionId);
  assert.equal(bucket.sectionTitle, "Any folder name");
  assert.equal(bucket.hubKind, "custom");
  const groups = groupReviewPickerRows([...byMaterial.values()]);
  assert.equal(groups[0]!.hubKind, "custom");
  assert.equal(
    pickerParentLabel(groups[0]!, fallbacks),
    "Any folder name"
  );
});

test("notes-only cards stay in per-note buckets with course metadata", () => {
  const byMaterial = new Map<string, SrsDueByMaterial>();
  const notesMeta = new Map<string, NotesFocusBucketMeta>([
    [
      notesFocusBucketId(NOTE_A),
      {
        fileName: "Chem recap",
        courseId: COURSE,
        courseTitle: "Organic Chemistry",
        noteDeleted: false,
      },
    ],
  ]);
  addPersonalFocusCount(
    byMaterial,
    { materialId: null, sourceNoteId: NOTE_A, sourceLabel: "Chem recap" },
    notesMeta
  );
  finalizeFocusBuckets(byMaterial);
  const bucket = byMaterial.get(notesFocusBucketId(NOTE_A))!;
  assert.equal(bucket.fileName, "Chem recap");
  assert.equal(bucket.courseTitle, "Organic Chemistry");
  assert.equal(bucket.personal, 1);
});

test("source_label Lecture 2 without a note id is not generic Focus questions", () => {
  const byMaterial = new Map<string, SrsDueByMaterial>();
  addPersonalFocusCount(
    byMaterial,
    { materialId: null, sourceNoteId: null, sourceLabel: "Lecture 2" },
    new Map()
  );
  finalizeFocusBuckets(byMaterial);
  const groups = groupReviewPickerRows([...byMaterial.values()]);
  assert.equal(groups.length, 1);
  assert.equal(pickerParentLabel(groups[0]!, fallbacks), "Lecture 2");
  assert.notEqual(pickerParentLabel(groups[0]!, fallbacks), "Focus questions");
});

test("Lecture 3 PDF with a lecture label is course-origin, not a phantom notes row", () => {
  const byMaterial = new Map<string, SrsDueByMaterial>([
    [
      MAT,
      {
        materialId: MAT,
        fileName: "Lecture 3.pdf",
        courseId: COURSE,
        courseTitle: "PBHLTH 162A",
        module: 0,
        personal: 0,
        total: 0,
      },
    ],
  ]);
  for (let i = 0; i < 240; i++) {
    addPersonalFocusCount(
      byMaterial,
      {
        materialId: MAT,
        sourceNoteId: null,
        sourceLabel: "Lecture 3",
      },
      new Map()
    );
  }
  finalizeFocusBuckets(byMaterial);
  assert.equal(byMaterial.get(MAT)!.personal, 240);
  assert.equal(byMaterial.has("notes"), false);
  const groups = groupReviewPickerRows([...byMaterial.values()]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]!.courseTitle, "PBHLTH 162A");
  assert.equal(
    groups[0]!.children.some((c) => c.kind === "note"),
    false
  );
});

test("two notes on the same course stay as separate note children", () => {
  const byMaterial = new Map<string, SrsDueByMaterial>();
  const notesMeta = new Map<string, NotesFocusBucketMeta>([
    [
      notesFocusBucketId(NOTE_A),
      {
        fileName: "Lecture 2",
        courseId: PBHLTH,
        courseTitle: "PBHLTH 162A",
        noteDeleted: false,
      },
    ],
    [
      notesFocusBucketId(NOTE_B),
      {
        fileName: "Office hours",
        courseId: PBHLTH,
        courseTitle: "PBHLTH 162A",
        noteDeleted: false,
      },
    ],
  ]);
  addPersonalFocusCount(
    byMaterial,
    { materialId: null, sourceNoteId: NOTE_A, sourceLabel: "Lecture 2" },
    notesMeta
  );
  addPersonalFocusCount(
    byMaterial,
    { materialId: null, sourceNoteId: NOTE_B, sourceLabel: "Office hours" },
    notesMeta
  );
  finalizeFocusBuckets(byMaterial);
  const groups = groupReviewPickerRows([...byMaterial.values()]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]!.courseTitle, "PBHLTH 162A");
  assert.deepEqual(
    groups[0]!.children.map((c) => c.fileName).sort(),
    ["Lecture 2", "Office hours"]
  );
});
