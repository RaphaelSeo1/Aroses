import assert from "node:assert/strict";
import test from "node:test";
import { Schema } from "@tiptap/pm/model";
import { buildFocusExcerpt } from "./focus-excerpt";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    heading: {
      group: "block",
      content: "inline*",
      attrs: { level: { default: 2 } },
    },
    text: { group: "inline" },
  },
  marks: {
    bold: {},
    highlight: { attrs: { color: { default: null } } },
  },
});

function docFrom(
  blocks: Array<
    | { type: "heading"; text: string; level?: number }
    | { type: "p"; text: string; mark?: "bold" | "highlight"; markFrom?: number; markTo?: number }
  >
) {
  return schema.node(
    "doc",
    null,
    blocks.map((b) => {
      if (b.type === "heading") {
        return schema.node("heading", { level: b.level ?? 2 }, [
          schema.text(b.text),
        ]);
      }
      if (b.mark) {
        const from = b.markFrom ?? 0;
        const to = b.markTo ?? b.text.length;
        const parts = [];
        if (from > 0) parts.push(schema.text(b.text.slice(0, from)));
        parts.push(
          schema.text(b.text.slice(from, to), [
            schema.mark(b.mark, b.mark === "highlight" ? { color: "#fde68a" } : {}),
          ])
        );
        if (to < b.text.length) parts.push(schema.text(b.text.slice(to)));
        return schema.node("paragraph", null, parts);
      }
      return schema.node("paragraph", null, [schema.text(b.text)]);
    })
  );
}

test("selection of a full paragraph is used as-is", () => {
  const doc = docFrom([
    { type: "heading", text: "Cells" },
    { type: "p", text: "Mitochondria produce ATP for the rest of the cell." },
  ]);
  const from = doc.child(0).nodeSize;
  const to = from + doc.child(1).nodeSize;
  const excerpt = buildFocusExcerpt({ doc, from: from + 1, to: to - 1 });
  assert.equal(excerpt.usedSection, false);
  assert.match(excerpt.corpus, /Mitochondria produce ATP/);
});

test("short selection is wrapped with parent-block context", () => {
  const text = "Mitochondria produce ATP for the rest of the cell.";
  const doc = docFrom([{ type: "p", text }]);
  const paraStart = 1;
  const termFrom = paraStart + text.indexOf("Mitochondria");
  const termTo = termFrom + "Mitochondria".length;
  const excerpt = buildFocusExcerpt({ doc, from: termFrom, to: termTo });
  assert.equal(excerpt.usedSection, false);
  assert.match(excerpt.corpus, /FOCUS ON: Mitochondria/);
  assert.match(excerpt.corpus, /produce ATP/);
});

test("collapsed caret in a heading section uses that section", () => {
  const doc = docFrom([
    { type: "heading", text: "Osmosis" },
    { type: "p", text: "Water moves toward higher solute concentration." },
    { type: "heading", text: "Diffusion" },
    { type: "p", text: "Particles spread from high to low concentration." },
  ]);
  const caret = 2;
  const excerpt = buildFocusExcerpt({ doc, from: caret, to: caret });
  assert.equal(excerpt.usedSection, true);
  assert.match(excerpt.corpus, /Osmosis/);
  assert.match(excerpt.corpus, /Water moves/);
  assert.doesNotMatch(excerpt.corpus, /Diffusion/);
});
