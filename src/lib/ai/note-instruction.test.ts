import assert from "node:assert/strict";
import test from "node:test";
import {
  buildNoteInstructionModifier,
  clampNoteInstruction,
  NOTE_INSTRUCTION_MAX,
} from "./note-instruction";

test("empty / whitespace / nullish input is a strict no-op", () => {
  assert.equal(buildNoteInstructionModifier(""), "");
  assert.equal(buildNoteInstructionModifier("   \n\t  "), "");
  assert.equal(buildNoteInstructionModifier(null), "");
  assert.equal(buildNoteInstructionModifier(undefined), "");
});

test("normal text is wrapped with the guardrail header", () => {
  const out = buildNoteInstructionModifier("more worked examples, short bullets");
  assert.ok(out.startsWith("\nSTUDENT'S NOTE REQUEST FOR THIS SESSION"));
  assert.ok(out.includes("style/emphasis only"));
  assert.ok(out.includes("NEVER authorize invented facts"));
  assert.ok(out.endsWith("\nmore worked examples, short bullets"));
});

test("over-long text is clamped to NOTE_INSTRUCTION_MAX", () => {
  const long = "x".repeat(NOTE_INSTRUCTION_MAX * 3);
  const out = buildNoteInstructionModifier(long);
  const body = out.split("\n").at(-1) ?? "";
  assert.equal(body.length, NOTE_INSTRUCTION_MAX);
});

test("internal whitespace is collapsed before clamping", () => {
  const out = buildNoteInstructionModifier("keep   bullets\n\nshort");
  assert.ok(out.endsWith("\nkeep bullets short"));
});

test("clampNoteInstruction clamps and rejects non-strings", () => {
  assert.equal(clampNoteInstruction(42), "");
  assert.equal(clampNoteInstruction(undefined), "");
  assert.equal(clampNoteInstruction("  hi   there  "), "hi there");
  assert.equal(
    clampNoteInstruction("y".repeat(NOTE_INSTRUCTION_MAX + 50)).length,
    NOTE_INSTRUCTION_MAX
  );
});
