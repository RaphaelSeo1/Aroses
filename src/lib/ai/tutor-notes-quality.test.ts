import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_NOTES_OUTLINE_RULES } from "./tutor-notes-quality";

test("shared default outline requires prose and grouped nested points", () => {
  assert.match(DEFAULT_NOTES_OUTLINE_RULES, /topic heading/i);
  assert.match(DEFAULT_NOTES_OUTLINE_RULES, /framing paragraph/i);
  assert.match(DEFAULT_NOTES_OUTLINE_RULES, /nested children/i);
  assert.match(DEFAULT_NOTES_OUTLINE_RULES, /Avoid a long flat list/i);
  assert.match(DEFAULT_NOTES_OUTLINE_RULES, /Continued detail enriches/i);
});
