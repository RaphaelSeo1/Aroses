import assert from "node:assert/strict";
import test from "node:test";
import { extractStreamingLessonContents } from "./refine-stream-extract";

test("reads a complete content string", () => {
  const partial =
    '{"id":1,"title":"M","lessons":[{"title":"L","content":"Hello world","key_terms":[]}';
  assert.deepEqual(extractStreamingLessonContents(partial), [
    { index: 0, content: "Hello world", complete: true },
  ]);
});

test("reads an incomplete content string while streaming", () => {
  const partial = '{"lessons":[{"title":"L","content":"Secular trends are';
  assert.deepEqual(extractStreamingLessonContents(partial), [
    { index: 0, content: "Secular trends are", complete: false },
  ]);
});

test("handles escapes and multiple lessons", () => {
  const partial =
    '{"lessons":[{"content":"Line 1\\nLine 2"},{"content":"Second';
  assert.deepEqual(extractStreamingLessonContents(partial), [
    { index: 0, content: "Line 1\nLine 2", complete: true },
    { index: 1, content: "Second", complete: false },
  ]);
});
