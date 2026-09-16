import assert from "node:assert/strict";
import test from "node:test";
import {
  courseIdForNotesFocusBucket,
  isGenericFocusTitle,
  isNotesFocusBucketId,
  isNotesOriginFocusCard,
  notesFocusBucketId,
  NOTES_FOCUS_BUCKET_ID,
  parseNotesFocusBucketNoteId,
} from "./notes-focus-bucket.ts";

test("notesFocusBucketId uses per-note buckets when note id is known", () => {
  const noteId = "fb09431c-315e-4027-bfee-c7a58e1a0001";
  assert.equal(notesFocusBucketId(noteId), `note:${noteId}`);
  assert.equal(isNotesFocusBucketId(`note:${noteId}`), true);
  assert.equal(parseNotesFocusBucketNoteId(`note:${noteId}`), noteId);
});

test("legacy bucket id still recognized", () => {
  assert.equal(notesFocusBucketId(null), NOTES_FOCUS_BUCKET_ID);
  assert.equal(isNotesFocusBucketId(NOTES_FOCUS_BUCKET_ID), true);
});

test("isGenericFocusTitle rejects placeholders but keeps real note titles", () => {
  assert.equal(isGenericFocusTitle("Focus questions"), true);
  assert.equal(isGenericFocusTitle("Notes"), true);
  assert.equal(isGenericFocusTitle("Lecture 2"), false);
  assert.equal(isGenericFocusTitle("PBHLTH 162A"), false);
});

test("isNotesOriginFocusCard is the note id or a notes-only row, not a PDF label", () => {
  const noteId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const materialId = "22222222-2222-4222-8222-222222222222";
  assert.equal(
    isNotesOriginFocusCard({ materialId, sourceNoteId: noteId }),
    true
  );
  assert.equal(
    isNotesOriginFocusCard({ materialId: null, sourceNoteId: null }),
    true
  );
  assert.equal(
    isNotesOriginFocusCard({ materialId, sourceNoteId: null }),
    false
  );
});

test("live session course wins over a stale note course_id", () => {
  const pbhlth = "44444444-4444-4444-8444-444444444444";
  const mcb = "11111111-1111-4111-8111-111111111111";
  assert.equal(courseIdForNotesFocusBucket(mcb, pbhlth), pbhlth);
  assert.equal(courseIdForNotesFocusBucket(mcb, null), mcb);
  assert.equal(courseIdForNotesFocusBucket(null, pbhlth), pbhlth);
});
