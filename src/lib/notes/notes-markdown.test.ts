import assert from "node:assert/strict";
import test from "node:test";
import {
  consumeGfmTable,
  isGfmTableSeparatorLine,
  markdownToNoteNodes,
  noteNodesToMarkdown,
  parseInlineMarkdown,
  sanitizeIncompleteInlineMarkdown,
  type NoteNodeJson,
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

test("detects GFM table separator rows", () => {
  assert.equal(isGfmTableSeparatorLine("| --- | --- |"), true);
  assert.equal(isGfmTableSeparatorLine("| :--- | ---: |"), true);
  assert.equal(isGfmTableSeparatorLine("| Drug | Dose |"), false);
});

test("parses a GFM pipe table into TipTap nodes", () => {
  const md = [
    "## Compare",
    "| Drug | Dose |",
    "| --- | --- |",
    "| **Aspirin** | 81 mg |",
    "| Ibuprofen | 200 mg |",
  ].join("\n");
  const nodes = markdownToNoteNodes(md, { sectionId: "s1", provenance: "ai" });
  assert.equal(nodes[0]?.type, "heading");
  assert.equal(nodes[1]?.type, "table");
  const rows = nodes[1]?.content ?? [];
  assert.equal(rows.length, 3);
  const headerRow = rows[0] as NoteNodeJson;
  const bodyRow = rows[1] as NoteNodeJson;
  assert.equal(headerRow.content?.[0]?.type, "tableHeader");
  assert.equal(bodyRow.content?.[0]?.type, "tableCell");
  const roundTrip = noteNodesToMarkdown(nodes);
  assert.match(roundTrip, /\| Drug \| Dose \|/);
  assert.match(roundTrip, /\| --- \| --- \|/);
  assert.match(roundTrip, /Aspirin/);
});

test("consumeGfmTable treats first row as header when separator missing", () => {
  const lines = ["| A | B |", "| 1 | 2 |"];
  const parsed = consumeGfmTable(lines, 0);
  assert.ok(parsed);
  assert.equal(parsed!.end, 2);
  assert.equal(parsed!.node.content?.length, 2);
  assert.equal(
    (parsed!.node.content?.[0] as { content?: { type: string }[] })?.content?.[0]
      ?.type,
    "tableHeader"
  );
});
