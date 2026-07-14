import assert from "node:assert/strict";
import test from "node:test";
import {
  parseInlineMarkdown,
  sanitizeIncompleteInlineMarkdown,
} from "./notes-markdown";

test("parses closed **bold** spans", () => {
  const nodes = parseInlineMarkdown("see **term** here");
  assert.deepEqual(nodes, [
    { type: "text", text: "see " },
    { type: "text", text: "term", marks: [{ type: "bold" }] },
    { type: "text", text: " here" },
  ]);
});

test("parses closed *italic* spans", () => {
  const nodes = parseInlineMarkdown("say *softly* now");
  assert.deepEqual(nodes, [
    { type: "text", text: "say " },
    { type: "text", text: "softly", marks: [{ type: "italic" }] },
    { type: "text", text: " now" },
  ]);
});

test("prefers **bold** over nested single asterisks", () => {
  const nodes = parseInlineMarkdown("**Open question:** left");
  assert.equal(nodes[0]?.marks?.[0]?.type, "bold");
  assert.equal(nodes[0]?.text, "Open question:");
});

test("unclosed ** stays literal until sanitized", () => {
  const raw = parseInlineMarkdown("start **term");
  assert.deepEqual(raw, [{ type: "text", text: "start **term" }]);
  assert.equal(
    sanitizeIncompleteInlineMarkdown("start **term"),
    "start term"
  );
});

test("sanitize strips dangling single *", () => {
  assert.equal(sanitizeIncompleteInlineMarkdown("foo *bar"), "foo bar");
  assert.equal(sanitizeIncompleteInlineMarkdown("*only"), "only");
});

test("sanitize leaves complete markers alone", () => {
  assert.equal(
    sanitizeIncompleteInlineMarkdown("keep **bold** and *ital*"),
    "keep **bold** and *ital*"
  );
});
