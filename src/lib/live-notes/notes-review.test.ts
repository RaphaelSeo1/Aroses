import assert from "node:assert/strict";
import test from "node:test";
import {
  markdownToNoteNodes,
  noteNodesToMarkdown,
  type NoteNodeJson,
} from "@/lib/notes/notes-markdown";
import {
  collectNoteDraftSections,
  liveNotesToPlainText,
  replaceAiNoteDraft,
} from "./notes-review";

test("canonical replacement removes old AI drafts but preserves student notes", () => {
  const first = markdownToNoteNodes(
    "## Energy transfer\n- ATP stores transferable energy.",
    { sectionId: "ai-1", provenance: "ai" }
  );
  const duplicate = markdownToNoteNodes(
    "## ATP details\n- ATP provides transferable energy.",
    { sectionId: "ai-2", provenance: "ai" }
  );
  const student = markdownToNoteNodes(
    "## My question\n- Ask why hydrolysis is favorable.",
    { sectionId: "student-1", provenance: "ai-edited" }
  );
  const doc = {
    type: "doc",
    attrs: { roseLectureRecap: "keep me" },
    content: [
      ...first,
      { type: "horizontalRule", attrs: { provenance: "ai" } },
      ...duplicate,
      ...student,
    ] as NoteNodeJson[],
  };

  const next = replaceAiNoteDraft(
    doc,
    "## ATP and energy transfer\nATP links energy-releasing and energy-requiring reactions.\n\n- **Hydrolysis:** releases transferable free energy."
  ) as typeof doc;
  const markdown = noteNodesToMarkdown(next.content);
  assert.match(markdown, /## ATP and energy transfer/);
  assert.doesNotMatch(markdown, /## Energy transfer\n/);
  assert.doesNotMatch(markdown, /## ATP details/);
  assert.match(markdown, /## My question/);
  assert.equal(next.attrs.roseLectureRecap, "keep me");
  assert.match(liveNotesToPlainText(next), /ATP and energy transfer/);
  assert.doesNotMatch(liveNotesToPlainText(next), /##|\*\*/);

  const drafts = collectNoteDraftSections(next);
  assert.equal(drafts.length, 2);
  assert.equal(drafts[0]?.studentEdited, false);
  assert.equal(drafts[1]?.studentEdited, true);
});

test("canonical replacement can create notes from sources when draft is empty", () => {
  const doc = {
    type: "doc",
    content: [{ type: "paragraph" }] as NoteNodeJson[],
  };
  const next = replaceAiNoteDraft(
    doc,
    "## New concept\n- Source-supported detail."
  ) as typeof doc;
  assert.match(noteNodesToMarkdown(next.content), /## New concept/);
});
