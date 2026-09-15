import assert from "node:assert/strict";
import test from "node:test";
import { parseSrsSessionScope, personalCardInScope } from "./srs-session-scope.ts";

const MAT = "22222222-2222-4222-8222-222222222222";
const NOTE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NOTE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

test("unrestricted scope includes every personal card", () => {
  const scope = parseSrsSessionScope({});
  assert.equal(scope.hasRestriction, false);
  assert.equal(
    personalCardInScope(scope, { materialId: MAT, sourceNoteId: NOTE_A }),
    true
  );
});

test("material-only (no note filter) includes all personal cards on that material", () => {
  const scope = parseSrsSessionScope({ materialIds: MAT });
  assert.equal(scope.noteFilterActive, false);
  assert.equal(
    personalCardInScope(scope, { materialId: MAT, sourceNoteId: NOTE_A }),
    true
  );
  assert.equal(
    personalCardInScope(scope, { materialId: MAT, sourceNoteId: NOTE_B }),
    true
  );
});

test("note bucket selects personal cards by source_note_id even with a material_id", () => {
  const scope = parseSrsSessionScope({ materialIds: `note:${NOTE_A}` });
  assert.equal(scope.noteFilterActive, true);
  assert.equal(
    personalCardInScope(scope, { materialId: MAT, sourceNoteId: NOTE_A }),
    true
  );
  assert.equal(
    personalCardInScope(scope, { materialId: MAT, sourceNoteId: NOTE_B }),
    false
  );
  assert.equal(
    personalCardInScope(scope, { materialId: null, sourceNoteId: NOTE_A }),
    true
  );
});

test("empty noteIds with a material excludes note-sourced cards on that material", () => {
  const scope = parseSrsSessionScope({
    materialIds: MAT,
    noteIds: "",
    noteIdsSpecified: true,
  });
  assert.equal(scope.noteFilterActive, true);
  assert.equal(
    personalCardInScope(scope, { materialId: MAT, sourceNoteId: NOTE_A }),
    false
  );
  assert.equal(
    personalCardInScope(scope, { materialId: MAT, sourceNoteId: null }),
    true
  );
});

test("noteIds csv selects a subset of notes on a shared material", () => {
  const scope = parseSrsSessionScope({
    materialIds: `${MAT},note:${NOTE_A}`,
    noteIds: NOTE_A,
    noteIdsSpecified: true,
  });
  assert.equal(
    personalCardInScope(scope, { materialId: MAT, sourceNoteId: NOTE_A }),
    true
  );
  assert.equal(
    personalCardInScope(scope, { materialId: MAT, sourceNoteId: NOTE_B }),
    false
  );
});
