import assert from "node:assert/strict";
import test from "node:test";
import {
  extractNoteHeading,
  headingsReferToSameTopic,
  matchHeadingToSections,
  uniqueIncomingNoteLines,
} from "./fold-note-markdown";

test("extractNoteHeading reads the first ATX heading", () => {
  assert.equal(
    extractNoteHeading("## Adrenergic receptors\n- Alpha-1 on vessels."),
    "Adrenergic receptors"
  );
  assert.equal(extractNoteHeading("- no heading here"), null);
});

test("headingsReferToSameTopic matches reworded near-duplicates", () => {
  assert.equal(
    headingsReferToSameTopic("Adrenergic receptors", "Adrenergic receptor types"),
    true
  );
  assert.equal(
    headingsReferToSameTopic("Krebs cycle", "The citric acid cycle"),
    false
  );
  assert.equal(headingsReferToSameTopic("Dose table", "Dose table"), true);
});

test("matchHeadingToSections finds the existing section, not the latest", () => {
  const sections = [
    { sectionId: "early", markdown: "## Adrenergic receptors\n- Alpha-1." },
    { sectionId: "late", markdown: "## Appendix\n- Extra reading." },
  ];
  const hit = matchHeadingToSections("## Adrenergic receptors", sections);
  assert.equal(hit?.sectionId, "early");
});

test("uniqueIncomingNoteLines drops restated bullets and keeps new ones", () => {
  const existing = "## Receptors\n- Alpha-1 on vessels.\n- Beta-1 on the heart.";
  const incoming =
    "## Receptors\n- Alpha-1 on vessels.\n- Also used as pressors in shock.";
  const extra = uniqueIncomingNoteLines(existing, incoming);
  assert.match(extra, /pressors in shock/);
  assert.doesNotMatch(extra, /Alpha-1 on vessels/);
});

test("uniqueIncomingNoteLines is empty when the slice is a restatement", () => {
  const existing = "## Receptors\n- Alpha-1 on vessels.\n- Beta-1 on the heart.";
  const incoming = "## Receptor types\n- Alpha-1 on vessels.\n- Beta-1 on the heart.";
  assert.equal(uniqueIncomingNoteLines(existing, incoming), "");
});
