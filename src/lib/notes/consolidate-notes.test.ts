import assert from "node:assert/strict";
import test from "node:test";
import { consolidateNoteDocument } from "./consolidate-notes";
import { containsEditorialNavigation } from "./cross-section-dedupe";
import { assertNoDuplicateTopics } from "@/lib/live-notes/fold-note-markdown";

/**
 * Synthetic, subject-neutral documents shaped like each generator's output.
 * The same shared function must clean all three the same way.
 */

// Live lecture notes: "## " topics, bold lead-ins, nested bullets, emphasis.
const liveDoc = [
  {
    sectionId: "l-1",
    markdown: [
      "## Topic A",
      "- **Alpha process:** Starts the workflow and validates the input.",
      "  - Runs once per request.",
      "- **Why it matters:** The first stage is a common exam question.",
    ].join("\n"),
  },
  {
    sectionId: "l-2",
    markdown: [
      "## Topic B",
      "- **Alpha process** is the stage that validates the input and starts the workflow.",
      "- **Gamma rule:** Applies after the alpha process finishes.",
      "| Stage | Result |",
      "| --- | --- |",
      "| Alpha | ok |",
    ].join("\n"),
  },
  {
    sectionId: "l-3",
    markdown: "## Topic A (continued)\n- **Beta gate:** Checks the input size before anything else runs.",
  },
];

// Mentored notes: one section per lesson chunk, framing prose + "### " subtopics.
const mentoredDoc = [
  {
    sectionId: "m-1",
    markdown: [
      "## Alpha process",
      "The alpha process is the first stage of the workflow and validates every input.",
      "- **Alpha process:** Starts the workflow and validates the input.",
      "### Worked example",
      "1. Start the alpha process with input size 3.",
      "2. The gate accepts the input.",
    ].join("\n"),
  },
  {
    sectionId: "m-2",
    markdown: [
      "## Gamma rule",
      "Before the gamma rule, recall the pipeline order.",
      "- **Alpha process:** Starts the workflow and validates the input.",
      "- **Gamma rule:** Applies after the alpha process finishes.",
      "  - Skipped on weekends.",
    ].join("\n"),
  },
];

// Tutor notes: heading + intro + bullets + "### Key vocabulary" + callout.
const tutorDoc = [
  {
    sectionId: "t-1",
    markdown: [
      "## Alpha process basics",
      "Rose explained the first stage.",
      "- **Alpha process:** Starts the workflow and validates the input.",
      "### Key vocabulary",
      "- **Beta gate** — Checks the input size before anything else runs.",
      "> 💡 Remember: the first stage runs before any gate.",
    ].join("\n"),
  },
  {
    sectionId: "t-2",
    markdown: [
      "## Gamma rule and ordering",
      "- **Gamma rule:** Applies after the alpha process finishes.",
      "- The beta gate checks the input size before anything else runs.",
      "### Key vocabulary",
      "- **Alpha process** — Starts the workflow and validates the input.",
      "- **Gamma rule** — Applies after the alpha process finishes.",
    ].join("\n"),
  },
];

function allText(sections: Array<{ markdown: string }>): string {
  return sections.map((s) => s.markdown).join("\n");
}

test("live-shaped doc: repeated definition removed, same-topic sections merged, table kept", () => {
  const res = consolidateNoteDocument(liveDoc);
  assert.equal(res.changed, true);
  const text = allText(res.sections);
  assertNoDuplicateTopics(res.sections);
  // "Topic A (continued)" folded into "Topic A".
  assert.deepEqual(res.removeSectionIds, ["l-3"]);
  assert.match(res.sections[0]!.markdown, /Beta gate/);
  // Redundant re-definition gone; exactly one definition remains.
  assert.equal(text.split("validates the input").length - 1, 1);
  // New info + table + emphasis + nested detail all survive.
  for (const keep of ["Gamma rule", "| Alpha | ok |", "Why it matters", "Runs once per request"]) {
    assert.ok(text.includes(keep), `missing: ${keep}`);
  }
  assert.equal(containsEditorialNavigation(text), false, text);
});

test("mentored-shaped doc: later chunk keeps only what it adds; worked example untouched", () => {
  const res = consolidateNoteDocument(mentoredDoc);
  assert.equal(res.changed, true);
  const m2 = res.sections.find((s) => s.sectionId === "m-2")!;
  assert.doesNotMatch(m2.markdown, /\*\*Alpha process:\*\*/);
  assert.match(m2.markdown, /Gamma rule/);
  assert.match(m2.markdown, /Skipped on weekends/);
  const m1 = res.sections.find((s) => s.sectionId === "m-1")!;
  assert.match(m1.markdown, /1\. Start the alpha process with input size 3\./);
  assert.match(m1.markdown, /2\. The gate accepts the input\./);
  assert.equal(containsEditorialNavigation(allText(res.sections)), false);
});

test("tutor-shaped doc: repeated vocabulary definitions collapse, callout survives", () => {
  const res = consolidateNoteDocument(tutorDoc);
  assert.equal(res.changed, true);
  const text = allText(res.sections);
  // Each definition appears once across the notebook.
  assert.equal(text.split("Starts the workflow and validates the input").length - 1, 1);
  assert.equal(text.split("Checks the input size before anything else runs").length - 1, 1);
  assert.equal(text.split("Applies after the alpha process finishes").length - 1, 1);
  assert.match(text, /> 💡 Remember: the first stage runs before any gate\./);
  assert.equal(containsEditorialNavigation(text), false, text);
  // Revisions only name changed sections; nothing was wrongly removed.
  assert.deepEqual(res.removeSectionIds, []);
  assert.ok(res.revisions.some((r) => r.sectionId === "t-2"));
});

test("student-edited sections are neither modified nor used as merge targets", () => {
  const res = consolidateNoteDocument([
    {
      sectionId: "s-student",
      studentEdited: true,
      markdown: "## Topic A\n- my own words about alpha process starting the workflow",
    },
    {
      sectionId: "s-ai",
      markdown: "## Topic A\n- **Alpha process:** Starts the workflow and validates the input.",
    },
  ]);
  assert.equal(res.changed, false);
  assert.equal(res.sections[0]!.markdown, "## Topic A\n- my own words about alpha process starting the workflow");
  assert.equal(res.sections.length, 2);
});

test("a clean document is left untouched", () => {
  const res = consolidateNoteDocument([
    { sectionId: "a", markdown: "## One\n- **First idea:** Does the first thing in the sequence." },
    { sectionId: "b", markdown: "## Two\n- **Second idea:** Does the second thing after the first idea." },
  ]);
  assert.equal(res.changed, false);
  assert.deepEqual(res.revisions, []);
  assert.deepEqual(res.removeSectionIds, []);
});
