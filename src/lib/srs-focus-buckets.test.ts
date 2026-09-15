import assert from "node:assert/strict";
import test from "node:test";
import { addPersonalFocusCount, finalizeFocusBuckets } from "./srs-focus-buckets.ts";
import type { NotesFocusBucketMeta } from "./notes/hydrate-notes-focus-buckets.ts";
import type { SrsDueByMaterial } from "./srs-due.ts";
import { notesFocusBucketId } from "./notes/notes-focus-bucket.ts";

const MAT = "22222222-2222-4222-8222-222222222222";
const COURSE = "11111111-1111-4111-8111-111111111111";
const NOTE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NOTE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

test("personal cards with material_id nest under that course by source_note_id", () => {
  const byMaterial = new Map<string, SrsDueByMaterial>([
    [
      MAT,
      {
        materialId: MAT,
        fileName: "Biology.pdf",
        courseId: COURSE,
        courseTitle: "Biology 101",
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
        courseId: COURSE,
        courseTitle: "Biology 101",
        noteDeleted: false,
      },
    ],
    [
      notesFocusBucketId(NOTE_B),
      {
        fileName: "Office hours",
        courseId: COURSE,
        courseTitle: "Biology 101",
        noteDeleted: false,
      },
    ],
  ]);
  addPersonalFocusCount(
    byMaterial,
    { materialId: MAT, sourceNoteId: NOTE_A, sourceLabel: "Lecture 2" },
    notesMeta
  );
  addPersonalFocusCount(
    byMaterial,
    { materialId: MAT, sourceNoteId: NOTE_A, sourceLabel: "Lecture 2" },
    notesMeta
  );
  addPersonalFocusCount(
    byMaterial,
    { materialId: MAT, sourceNoteId: NOTE_B, sourceLabel: "Office hours" },
    notesMeta
  );
  finalizeFocusBuckets(byMaterial);
  const parent = byMaterial.get(MAT)!;
  assert.equal(parent.personal, 3);
  assert.equal(parent.notes?.length, 2);
  assert.equal(parent.notes?.[0]?.fileName, "Lecture 2");
  assert.equal(parent.notes?.[0]?.personal, 2);
  assert.equal(byMaterial.has(notesFocusBucketId(NOTE_A)), false);
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
