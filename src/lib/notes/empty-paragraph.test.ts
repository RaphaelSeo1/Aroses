import assert from "node:assert/strict";
import test from "node:test";
import { Schema } from "@tiptap/pm/model";
import {
  isEmptyParagraph,
  trailingEmptyParagraphRange,
} from "./empty-paragraph";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    heading: {
      group: "block",
      content: "inline*",
      attrs: { level: { default: 1 } },
    },
    text: { group: "inline" },
  },
});

test("isEmptyParagraph is true only for blank paragraphs", () => {
  assert.equal(isEmptyParagraph(schema.node("paragraph")), true);
  assert.equal(
    isEmptyParagraph(schema.node("paragraph", null, [schema.text("hi")])),
    false
  );
  assert.equal(
    isEmptyParagraph(
      schema.node("heading", { level: 2 }, [schema.text("Topic")])
    ),
    false
  );
});

test("trailingEmptyParagraphRange is null when the last block has text", () => {
  const doc = schema.node("doc", null, [
    schema.node("heading", { level: 2 }, [schema.text("Topic")]),
    schema.node("paragraph", null, [schema.text("body")]),
  ]);
  assert.equal(trailingEmptyParagraphRange(doc), null);
});

test("trailingEmptyParagraphRange covers empty paragraphs after real content", () => {
  const keep = schema.node("paragraph", null, [schema.text("keep")]);
  const doc = schema.node("doc", null, [
    keep,
    schema.node("paragraph"),
    schema.node("paragraph"),
  ]);
  const range = trailingEmptyParagraphRange(doc);
  assert.ok(range);
  assert.equal(range.from, keep.nodeSize);
  assert.equal(range.to, doc.content.size);
});

test("a lone empty doc paragraph is the whole trailing range", () => {
  const empty = schema.node("paragraph");
  const doc = schema.node("doc", null, [empty]);
  const range = trailingEmptyParagraphRange(doc);
  assert.deepEqual(range, { from: 0, to: empty.nodeSize });
});
