import assert from "node:assert/strict";
import test from "node:test";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import {
  clampIndent,
  Indent,
  MAX_INDENT,
  parseIndentAttr,
} from "./Indent";

test("clampIndent bounds the indent level", () => {
  assert.equal(clampIndent(0), 0);
  assert.equal(clampIndent(3), 3);
  assert.equal(clampIndent(-2), 0);
  assert.equal(clampIndent(MAX_INDENT + 4), MAX_INDENT);
  assert.equal(clampIndent("2"), 2);
  assert.equal(clampIndent("nope"), 0);
});

test("parseIndentAttr reads data-indent and padding-left em", () => {
  const el = { getAttribute: () => "2", style: { paddingLeft: "" } } as unknown as HTMLElement;
  assert.equal(parseIndentAttr(el), 2);

  const fromPad = {
    getAttribute: () => null,
    style: { paddingLeft: "3em" },
  } as unknown as HTMLElement;
  assert.equal(parseIndentAttr(fromPad), 2);

  const empty = {
    getAttribute: () => null,
    style: { paddingLeft: "" },
  } as unknown as HTMLElement;
  assert.equal(parseIndentAttr(empty), 0);
});

function paragraphEditor() {
  return new Editor({
    extensions: [StarterKit, Indent],
    content: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }],
    },
  });
}

test("indent / outdent persist on the paragraph", () => {
  const editor = paragraphEditor();
  try {
    assert.equal(editor.commands.indent(), true);
    assert.equal(editor.getJSON().content?.[0]?.attrs?.indent, 1);
    assert.equal(editor.commands.indent(), true);
    assert.equal(editor.getJSON().content?.[0]?.attrs?.indent, 2);
    assert.equal(editor.commands.outdent(), true);
    assert.equal(editor.getJSON().content?.[0]?.attrs?.indent, 1);
  } finally {
    editor.destroy();
  }
});

test("outdent at zero is a no-op", () => {
  const editor = paragraphEditor();
  try {
    assert.equal(editor.commands.outdent(), false);
    assert.equal(editor.getJSON().content?.[0]?.attrs?.indent ?? 0, 0);
  } finally {
    editor.destroy();
  }
});
