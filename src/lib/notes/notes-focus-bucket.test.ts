import assert from "node:assert/strict";
import test from "node:test";
import {
  isGenericFocusTitle,
  isNotesFocusBucketId,
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
