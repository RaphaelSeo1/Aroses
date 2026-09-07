import assert from "node:assert/strict";
import test from "node:test";
import type { NoteNodeJson } from "@/lib/notes/notes-markdown";
import {
  addressExistingNoteNodes,
  collectExistingNoteSections,
} from "./existing-note-sections";

const legacyMaterialNodes: NoteNodeJson[] = [
  {
    type: "heading",
    attrs: { level: 2 },
    content: [{ type: "text", text: "Cell respiration" }],
  },
  {
    type: "paragraph",
    content: [{ type: "text", text: "Glycolysis occurs in the cytosol." }],
  },
  {
    type: "heading",
    attrs: { level: 2 },
    content: [{ type: "text", text: "Photosynthesis" }],
  },
  {
    type: "paragraph",
    content: [{ type: "text", text: "Light reactions produce ATP." }],
  },
];

test("material-generated sections receive stable live revision addresses", () => {
  const first = addressExistingNoteNodes(legacyMaterialNodes);
  const second = addressExistingNoteNodes(legacyMaterialNodes);
  assert.equal(first.changed, true);
  assert.deepEqual(first.nodes, second.nodes);

  const sections = collectExistingNoteSections(first.nodes);
  assert.equal(sections.length, 2);
  assert.match(sections[0]!.markdown, /Cell respiration/);
  assert.match(sections[0]!.markdown, /Glycolysis occurs/);
  assert.match(sections[1]!.markdown, /Photosynthesis/);
  assert.notEqual(sections[0]!.sectionId, sections[1]!.sectionId);
});

test("addressing imported notes preserves provenance and existing IDs", () => {
  const nodes: NoteNodeJson[] = [
    {
      type: "heading",
      attrs: { level: 2, sectionId: "already-live", provenance: "ai" },
      content: [{ type: "text", text: "Existing" }],
    },
    {
      type: "paragraph",
      attrs: { provenance: "ai-edited" },
      content: [{ type: "text", text: "Student-adjusted wording." }],
    },
  ];
  const addressed = addressExistingNoteNodes(nodes).nodes;
  assert.equal(addressed[0]!.attrs?.sectionId, "already-live");
  assert.equal(addressed[1]!.attrs?.sectionId, "already-live");
  assert.equal(addressed[1]!.attrs?.provenance, "ai-edited");
  assert.equal(collectExistingNoteSections(addressed)[0]!.studentEdited, true);
});
