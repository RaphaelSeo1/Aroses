import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCanonicalNotesUserPrompt,
  CANONICAL_NOTES_SYSTEM,
  hasCanonicalNoteSources,
  splitCanonicalMarkdown,
} from "./canonical-synthesis";

test("files-only synthesis is comprehensive but filters incidental noise", () => {
  const prompt = buildCanonicalNotesUserPrompt({
    sources: {
      deck:
        "[slide 1] Cell signaling\nLigand binds receptor\nCopyright Example Press\nDOI 123",
    },
  });
  assert.match(prompt, /AUTHORITATIVE SOURCE — SLIDES \/ DECK/);
  assert.match(prompt, /Ligand binds receptor/);
  assert.match(CANONICAL_NOTES_SYSTEM, /copyright lines/);
  assert.match(CANONICAL_NOTES_SYSTEM, /Dense source material/);
});

test("transcript-only synthesis preserves instructional explanation", () => {
  const prompt = buildCanonicalNotesUserPrompt({
    sources: {
      transcript:
        "The valve closes because pressure reverses. Think of it like a one-way door.",
    },
  });
  assert.match(prompt, /AUTHORITATIVE SOURCE — LECTURE TRANSCRIPT/);
  assert.match(CANONICAL_NOTES_SYSTEM, /analogies/);
  assert.match(CANONICAL_NOTES_SYSTEM, /questions and answers/);
});

test("combined source prompt is independent of arrival order", () => {
  const first = buildCanonicalNotesUserPrompt({
    sources: { transcript: "spoken explanation", deck: "written structure" },
  });
  const second = buildCanonicalNotesUserPrompt({
    sources: { deck: "written structure", transcript: "spoken explanation" },
  });
  assert.equal(first, second);
  assert.match(CANONICAL_NOTES_SYSTEM, /does not need to appear in every source/);
});

test("existing notes are labeled as draft rather than evidence", () => {
  const prompt = buildCanonicalNotesUserPrompt({
    sources: { transcript: "The supported claim." },
    existingSections: [
      { sectionId: "ai-1", markdown: "## Old\n- Unsupported draft claim." },
      {
        sectionId: "student-1",
        markdown: "## My reminder\n- Ask about this.",
        studentEdited: true,
      },
    ],
  });
  assert.match(prompt, /EDITABLE MAP ONLY, NOT EVIDENCE/);
  assert.match(prompt, /STUDENT-EDITED SECTIONS — PRESERVE/);
  assert.match(CANONICAL_NOTES_SYSTEM, /Give each major concept one canonical location/);
});

test("uploaded material is a first-class authoritative source", () => {
  const prompt = buildCanonicalNotesUserPrompt({
    sources: {
      materials: [{ name: "reading.md", text: "A detailed mechanism." }],
    },
  });
  assert.equal(hasCanonicalNoteSources({ materials: [] }), false);
  assert.equal(
    hasCanonicalNoteSources({
      materials: [{ name: "reading.md", text: "A detailed mechanism." }],
    }),
    true
  );
  assert.match(prompt, /UPLOADED MATERIAL \(reading\.md\)/);
});

test("canonical markdown splits into one addressable H2 section", () => {
  assert.deepEqual(
    splitCanonicalMarkdown(
      "## First concept\n- One\n\n### Example\n- A\n\n## Second concept\n- Two"
    ),
    [
      "## First concept\n- One\n\n### Example\n- A",
      "## Second concept\n- Two",
    ]
  );
});
