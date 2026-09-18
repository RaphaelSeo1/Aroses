import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_NOTES_OUTLINE_RULES } from "./tutor-notes-quality";

test("shared default outline requires prose and grouped nested points", () => {
  assert.match(DEFAULT_NOTES_OUTLINE_RULES, /topic heading/i);
  assert.match(DEFAULT_NOTES_OUTLINE_RULES, /framing paragraph/i);
  assert.match(DEFAULT_NOTES_OUTLINE_RULES, /nested children/i);
  assert.match(DEFAULT_NOTES_OUTLINE_RULES, /as many top-level bullets as unique facts require/i);
  assert.match(DEFAULT_NOTES_OUTLINE_RULES, /Do not cap the number of bullets/i);
  assert.match(DEFAULT_NOTES_OUTLINE_RULES, /Continued detail enriches/i);
});
