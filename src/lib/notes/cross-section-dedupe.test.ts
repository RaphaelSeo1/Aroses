import assert from "node:assert/strict";
import test from "node:test";
import {
  applySemanticTrims,
  buildNaturalReminder,
  consolidateRepeatedExplanations,
  containsEditorialNavigation,
  startsWithDanglingReferent,
  stripEditorialNavigationLines,
  findRepeatedExplanations,
  findSemanticTrimCandidates,
  formatSemanticTrimCandidates,
  isRepeatedDefinition,
  isRepeatedNoteLine,
  parseSemanticTrimJson,
  stripLinesAlreadyCovered,
} from "./cross-section-dedupe";
import { assertNoDuplicateTopics } from "@/lib/live-notes/fold-note-markdown";

const owner = {
  sectionId: "s-1",
  markdown: [
    "## Topic A",
    "- **Alpha process:** Starts the workflow and validates the input.",
    "  - Runs once per request.",
    "- **Beta gate:** Checks the input size before anything else runs.",
    "- **Why it matters:** The first stage is a common exam question.",
  ].join("\n"),
};

test("repeated line: same meaning with different wording is detected", () => {
  assert.equal(
    isRepeatedNoteLine(
      "- **Alpha process:** Starts the workflow and validates the input.",
      "- The alpha process validates the input and starts the workflow."
    ),
    true
  );
});

test("repeated line: different numbers are different facts", () => {
  assert.equal(
    isRepeatedNoteLine(
      "- The beta gate rejects inputs above 4 KB.",
      "- The beta gate rejects inputs above 8 KB."
    ),
    false
  );
});

test("repeated definition: second definition of the same concept is redundant, new fact is not", () => {
  const first = "- **Alpha process:** Starts the workflow and validates the input.";
  assert.equal(
    isRepeatedDefinition(
      first,
      "- **Alpha process** is the stage that validates input and starts the workflow."
    ),
    true
  );
  assert.equal(
    isRepeatedDefinition(
      first,
      "- **Alpha process:** Emits a warning when the queue is full."
    ),
    false,
    "a new fact about the same concept must survive"
  );
});

test("consolidate: later re-explanation is removed silently, new details kept, no 'see above'", () => {
  const later = {
    sectionId: "s-2",
    markdown: [
      "## Topic B",
      "- **Alpha process** is the stage that validates the input and starts the workflow.",
      "  - Logs its start time.",
      "- **Gamma rule:** Applies after the alpha process finishes.",
      "- Runs once per request.",
    ].join("\n"),
  };
  const res = consolidateRepeatedExplanations([owner, later]);
  assert.equal(res.changed, true);
  assert.deepEqual(res.removeSectionIds, []);
  const b = res.sections.find((s) => s.sectionId === "s-2")!;
  const a = res.sections.find((s) => s.sectionId === "s-1")!;

  // Redundant definition + duplicate bullet gone from B.
  assert.doesNotMatch(b.markdown, /validates the input and starts/);
  assert.doesNotMatch(b.markdown, /^- Runs once per request\.$/m);
  // Genuinely new information stays in B; the removed definition leaves no
  // editorial pointer because the remaining lines stand on their own.
  assert.match(b.markdown, /Gamma rule/);
  assert.equal(containsEditorialNavigation(b.markdown), false, b.markdown);
  assert.doesNotMatch(b.markdown, /Alpha process/);
  // Unique nested detail moved under the owner.
  assert.match(a.markdown, /Logs its start time/);
  // Emphasis line untouched.
  assert.match(a.markdown, /Why it matters/);
  assertNoDuplicateTopics(res.sections);
});

test("consolidate: a natural one-clause reminder stays only when the next line depends on it", () => {
  const dependent = {
    sectionId: "s-dep",
    markdown: [
      "## Topic D",
      "- **Alpha process:** Starts the workflow and validates the input.",
      "- It also emits a heartbeat every 5 seconds while it runs.",
      "- **Delta step:** Runs after the heartbeat is confirmed.",
    ].join("\n"),
  };
  const res = consolidateRepeatedExplanations([owner, dependent]);
  const d = res.sections.find((s) => s.sectionId === "s-dep")!;
  // The dependent "It also …" line would dangle, so a short recall is kept —
  // phrased as ordinary notes, not as navigation.
  assert.match(d.markdown, /^- \*\*Alpha process:\*\* Starts the workflow and validates the input\.$/m);
  assert.match(d.markdown, /It also emits a heartbeat/);
  assert.match(d.markdown, /Delta step/);
  assert.equal(containsEditorialNavigation(d.markdown), false, d.markdown);
  assert.equal(res.trimmed[0]!.pointer !== undefined, true);

  // Same removal, but the next line stands on its own → nothing is kept.
  const independent = {
    sectionId: "s-ind",
    markdown: [
      "## Topic E",
      "- **Alpha process:** Starts the workflow and validates the input.",
      "- **Delta step:** Runs after the heartbeat is confirmed.",
    ].join("\n"),
  };
  const res2 = consolidateRepeatedExplanations([owner, independent]);
  const e = res2.sections.find((s) => s.sectionId === "s-ind")!;
  assert.doesNotMatch(e.markdown, /Alpha process/);
  assert.equal(res2.trimmed[0]!.pointer, undefined);
});

test("reminder helpers: dangling referents and natural phrasing", () => {
  assert.equal(startsWithDanglingReferent("- It runs twice."), true);
  assert.equal(startsWithDanglingReferent("- This means the gate closes."), true);
  assert.equal(startsWithDanglingReferent("- **Beta gate:** Checks size."), false);
  assert.equal(startsWithDanglingReferent("- **Why it matters:** exam."), false);
  const r = buildNaturalReminder(
    "Alpha process",
    "- **Alpha process:** Starts the workflow and validates the input; retries twice (see logs).",
    0
  );
  assert.equal(r, "- **Alpha process:** Starts the workflow and validates the input.");
  assert.equal(containsEditorialNavigation(r!), false);
});

test("navigation language is detected and stripped without touching facts", () => {
  for (const bad of [
    '- **Alpha process** — see "Topic A" above; only new details here.',
    "- As mentioned earlier, the beta gate checks the input size.",
    "- The gamma rule (covered above) applies after alpha.",
    "See above for the definition.",
  ]) {
    assert.equal(containsEditorialNavigation(bad), true, bad);
  }
  for (const ok of [
    "- Recall that the alpha process validates input before anything else runs.",
    "- **Why it matters:** The first stage is a common exam question.",
    "- The receiver sees the frame above the threshold and drops it.",
  ]) {
    assert.equal(containsEditorialNavigation(ok), false, ok);
  }
  const stripped = stripEditorialNavigationLines(
    [
      "## Topic",
      '- **Alpha process** — see "Topic A" above; only new details here.',
      "- As mentioned earlier, the beta gate checks the input size before anything else runs.",
      "- **Gamma rule:** Applies after alpha.",
    ].join("\n")
  );
  assert.equal(
    stripped,
    [
      "## Topic",
      "- The beta gate checks the input size before anything else runs.",
      "- **Gamma rule:** Applies after alpha.",
    ].join("\n")
  );
  assert.equal(containsEditorialNavigation(stripped), false);
});

test("consolidate: a later section that only restates earlier material is removed", () => {
  const restate = {
    sectionId: "s-3",
    markdown: [
      "## Recap of the pipeline",
      "- The alpha process validates the input and starts the workflow.",
      "- Beta gate checks the input size before anything else runs.",
    ].join("\n"),
  };
  const res = consolidateRepeatedExplanations([owner, restate]);
  assert.deepEqual(res.removeSectionIds, ["s-3"]);
  assert.equal(res.sections.length, 1);
});

test("consolidate: richer later wording upgrades the owner line", () => {
  const richer = {
    sectionId: "s-4",
    markdown:
      "## More on Topic A\n- **Beta gate:** Checks the input size before anything else runs, rejecting oversize payloads.\n- **Delta step:** New stage introduced today.",
  };
  const res = consolidateRepeatedExplanations([owner, richer]);
  const a = res.sections.find((s) => s.sectionId === "s-1")!;
  assert.match(a.markdown, /rejecting oversize payloads/);
  const d = res.sections.find((s) => s.sectionId === "s-4")!;
  assert.match(d.markdown, /Delta step/);
  assert.doesNotMatch(d.markdown, /rejecting oversize payloads/);
});

test("consolidate: student-edited sections are never modified", () => {
  const student = {
    sectionId: "s-5",
    studentEdited: true,
    markdown: "## My notes\n- The alpha process validates the input and starts the workflow.",
  };
  const res = consolidateRepeatedExplanations([owner, student]);
  assert.equal(res.changed, false);
  assert.equal(res.sections[1]!.markdown, student.markdown);
});

test("consolidate: repeated terminology without re-explanation is left alone", () => {
  const mention = {
    sectionId: "s-6",
    markdown:
      "## Topic C\n- The alpha process feeds its output into the **Epsilon buffer**.\n- **Epsilon buffer:** Holds up to 12 items.",
  };
  const res = consolidateRepeatedExplanations([owner, mention]);
  assert.equal(res.changed, false);
});

test("consolidate: worked examples and tables survive", () => {
  const example = {
    sectionId: "s-7",
    markdown: [
      "## Worked example",
      "1. Start the alpha process with input size 3.",
      "2. Beta gate accepts the input.",
      "| Stage | Result |",
      "| --- | --- |",
      "| Alpha | ok |",
    ].join("\n"),
  };
  const res = consolidateRepeatedExplanations([owner, example]);
  assert.equal(res.changed, false);
  assert.match(res.sections[1]!.markdown, /\| Alpha \| ok \|/);
});

test("findRepeatedExplanations reports owner and kind", () => {
  const hits = findRepeatedExplanations([
    owner,
    {
      sectionId: "s-8",
      markdown: "## Later\n- Beta gate checks the input size before anything else runs.",
    },
  ]);
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.ownerSectionId, "s-1");
  assert.equal(hits[0]!.kind, "duplicate");
});

test("stripLinesAlreadyCovered: drops restatements, keeps new lines, promotes new children", () => {
  const incoming = [
    "- **Alpha process** is the stage that validates the input and starts the workflow.",
    "  - Emits a heartbeat every 5 seconds.",
    "- **Zeta cache:** Stores the last result for reuse.",
  ].join("\n");
  const out = stripLinesAlreadyCovered(incoming, [owner]);
  assert.doesNotMatch(out, /validates the input and starts/);
  assert.match(out, /^- Emits a heartbeat every 5 seconds\.$/m);
  assert.match(out, /Zeta cache/);
});

test("semantic candidates: only later explanations are offered; parse rejects unknown lines", () => {
  const later = {
    sectionId: "s-9",
    markdown: [
      "## Applications",
      "- The **alpha process** can be thought of as the entry checkpoint that admits work into the pipeline.",
      "- Used by three downstream services.",
    ].join("\n"),
  };
  const candidates = findSemanticTrimCandidates([owner, later]);
  const alpha = candidates.find((c) => c.label.toLowerCase() === "alpha process");
  assert.ok(alpha, "alpha process should be a candidate");
  assert.equal(alpha!.later[0]!.sectionId, "s-9");
  assert.equal(alpha!.later[0]!.lines[0]!.n, 2);
  const text = formatSemanticTrimCandidates(candidates);
  assert.match(text, /OWNER \[s-1\] Topic A/);

  const trims = parseSemanticTrimJson(
    JSON.stringify({
      trims: [
        { sectionId: "s-9", dropLineNumbers: [2, 3, 99] },
        { sectionId: "s-1", dropLineNumbers: [2] },
      ],
    }),
    candidates
  );
  assert.deepEqual(trims, [{ sectionId: "s-9", dropLineNumbers: [2] }]);

  const applied = applySemanticTrims([owner, later], trims);
  assert.equal(applied.changed, true);
  const s9 = applied.sections.find((s) => s.sectionId === "s-9")!;
  assert.doesNotMatch(s9.markdown, /entry checkpoint/);
  assert.match(s9.markdown, /three downstream services/);
});

test("semantic trims never empty a section", () => {
  const only = {
    sectionId: "s-10",
    markdown: "## Solo\n- The alpha process is the entry checkpoint for the pipeline.",
  };
  const applied = applySemanticTrims(
    [owner, only],
    [{ sectionId: "s-10", dropLineNumbers: [2] }]
  );
  assert.equal(applied.changed, false);
});

test("comprehensiveness: every unique fact survives consolidation", () => {
  const b = {
    sectionId: "s-11",
    markdown: [
      "## Topic B",
      "- **Alpha process:** Starts the workflow and validates the input.",
      "- **Gamma rule:** Applies after the alpha process finishes.",
      "  - Skipped on weekends.",
      "- **Why it matters:** Gamma ordering is tested.",
    ].join("\n"),
  };
  const res = consolidateRepeatedExplanations([owner, b]);
  const all = res.sections.map((s) => s.markdown).join("\n");
  for (const fact of [
    "Starts the workflow and validates the input",
    "Runs once per request",
    "Checks the input size before anything else runs",
    "Applies after the alpha process finishes",
    "Skipped on weekends",
    "Gamma ordering is tested",
    "The first stage is a common exam question",
  ]) {
    assert.ok(all.includes(fact), `missing fact: ${fact}`);
  }
  // …and the repeated definition appears exactly once.
  const occurrences = all.split("Starts the workflow and validates the input").length - 1;
  assert.equal(occurrences, 1);
});
