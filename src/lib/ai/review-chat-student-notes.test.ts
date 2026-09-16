import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReviewChatStudentNotes,
  notesDocPathForId,
} from "./review-chat-student-notes";

const NOTE_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

test("notesDocPathForId builds a notes doc path", () => {
  assert.equal(notesDocPathForId(NOTE_ID), `/notes/doc/${NOTE_ID}`);
  assert.equal(notesDocPathForId("not-a-uuid"), null);
  assert.equal(notesDocPathForId(null), null);
});

test("buildReviewChatStudentNotes prefers full note body over excerpt", () => {
  const out = buildReviewChatStudentNotes({
    noteTitle: "Lecture 2",
    noteBody: "Osmosis is water moving toward higher solute.",
    sourceExcerpt: "Diffusion spreads particles from high to low concentration.",
    sourceNoteId: NOTE_ID,
  });
  assert.equal(out.hadStudentNotes, true);
  assert.equal(out.notesLink, `/notes/doc/${NOTE_ID}`);
  assert.equal(out.notesMissingForCard, false);
  assert.ok(out.contextBlock?.includes("Full note body:"));
  assert.ok(out.contextBlock?.includes("Osmosis is water moving toward higher solute."));
  assert.ok(out.contextBlock?.includes("never claim you cannot see them"));
});

test("buildReviewChatStudentNotes uses body alone when excerpt is contained", () => {
  const out = buildReviewChatStudentNotes({
    noteBody: "Osmosis is water moving toward higher solute.",
    sourceExcerpt: "Osmosis is water",
    sourceNoteId: NOTE_ID,
  });
  assert.equal(out.hadStudentNotes, true);
  assert.ok(out.contextBlock?.includes("Osmosis is water moving toward higher solute."));
  assert.ok(!out.contextBlock?.includes("Full note body:"));
});

test("buildReviewChatStudentNotes falls back to excerpt alone", () => {
  const out = buildReviewChatStudentNotes({
    sourceExcerpt: "Particles diffuse from high to low.",
    sourceNoteId: NOTE_ID,
  });
  assert.equal(out.hadStudentNotes, true);
  assert.ok(out.contextBlock?.includes("Particles diffuse from high to low."));
  assert.ok(!out.contextBlock?.includes("Full note body:"));
});

test("buildReviewChatStudentNotes marks missing when note id known but empty", () => {
  const out = buildReviewChatStudentNotes({
    noteBody: "   ",
    sourceExcerpt: "",
    sourceNoteId: NOTE_ID,
  });
  assert.equal(out.hadStudentNotes, false);
  assert.equal(out.notesLink, null);
  assert.equal(out.notesMissingForCard, true);
  assert.ok(out.contextBlock?.includes("none found for this card"));
  assert.ok(out.contextBlock?.includes("Do not claim you cannot see"));
});

test("buildReviewChatStudentNotes returns null when no note expected", () => {
  const out = buildReviewChatStudentNotes({});
  assert.equal(out.contextBlock, null);
  assert.equal(out.hadStudentNotes, false);
  assert.equal(out.notesMissingForCard, false);
});
