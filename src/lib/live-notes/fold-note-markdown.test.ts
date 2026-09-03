import assert from "node:assert/strict";
import test from "node:test";
import {
  extractNoteHeading,
  headingsReferToSameTopic,
  matchHeadingToSections,
  pickNoteFoldTarget,
  uniqueIncomingNoteLines,
  applySurgicalNoteRevision,
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

test("matchHeadingToSections uses the heading inside a full notes body", () => {
  const sections = [
    { sectionId: "s1", markdown: "## Scarcity\n- Resources are limited." },
    { sectionId: "s2", markdown: "## Demand\n- Buyers want goods." },
  ];
  const hit = matchHeadingToSections(
    "## Scarcity\n- Opportunity cost is the next-best option you give up.",
    sections
  );
  assert.equal(hit?.sectionId, "s1");
});

test("pickNoteFoldTarget folds bullets into the preferred section", () => {
  const sections = [
    { sectionId: "s1", markdown: "## Scarcity\n- Resources are limited." },
    { sectionId: "s2", markdown: "## Demand\n- Buyers want goods." },
  ];
  const hit = pickNoteFoldTarget(
    "- Opportunity cost is the next-best option you give up.",
    sections,
    "s1"
  );
  assert.equal(hit?.sectionId, "s1");
});

test("pickNoteFoldTarget leaves a new heading as a new section", () => {
  const sections = [
    { sectionId: "s1", markdown: "## Scarcity\n- Resources are limited." },
  ];
  assert.equal(
    pickNoteFoldTarget("## Deadweight loss\n- Surplus lost at the wrong quantity.", sections),
    null
  );
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

test("applySurgicalNoteRevision keeps the whole section when the model rewrites a short slice", () => {
  const existing = [
    "## Adrenergic receptors",
    "- Alpha-1 on vessels.",
    "- Beta-1 on the heart.",
    "- Beta-2 on the lungs.",
    "- Used as pressors in shock.",
  ].join("\n");
  const incoming = "## Adrenergic receptors\n- Beta-1 on the heart.";
  const next = applySurgicalNoteRevision(existing, incoming);
  assert.match(next.markdown, /Alpha-1 on vessels/);
  assert.match(next.markdown, /Beta-2 on the lungs/);
  assert.match(next.markdown, /pressors in shock/);
  assert.equal(next.patched, false);
  assert.equal(next.extraMarkdown, "");
});

test("applySurgicalNoteRevision patches a number and appends a new bullet", () => {
  const existing =
    "## Dose\n- Give epinephrine 1 mg IV.\n- Repeat every 3–5 minutes.";
  const incoming =
    "## Dose\n- Give epinephrine 1.5 mg IV.\n- Flush with saline after.";
  const next = applySurgicalNoteRevision(existing, incoming);
  assert.match(next.markdown, /1\.5 mg IV/);
  assert.doesNotMatch(next.markdown, /1 mg IV/);
  assert.match(next.markdown, /Repeat every 3–5 minutes/);
  assert.match(next.markdown, /Flush with saline/);
  assert.equal(next.patched, true);
});

