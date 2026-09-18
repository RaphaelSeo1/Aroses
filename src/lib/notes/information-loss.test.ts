import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  applySurgicalNoteRevision,
  classifyAppendChunks,
  dedupeSectionLines,
  findDuplicateTopicGroups,
  findUncoveredLines,
  headingsAreSameTitle,
  isCorrectedNoteLine,
  lineAddsNewInformation,
  mergeDuplicateGroup,
  sectionCoveredRatio,
  uniqueIncomingNoteLines,
} from "@/lib/live-notes/fold-note-markdown";
import {
  applySemanticTrims,
  consolidateRepeatedExplanations,
  containsEditorialNavigation,
  findSemanticTrimCandidates,
  isRepeatedDefinition,
  isRepeatedNoteLine,
  laterLineSupersedes,
  parseSemanticTrimJson,
  REPEATED_EXPLANATIONS_JOB_RULES,
  SEMANTIC_TRIM_INSTRUCTION,
  semanticTrimClearlyLosesInformation,
  stripEditorialNavigationLines,
  stripLinesAlreadyCovered,
} from "./cross-section-dedupe";
import { consolidateNoteDocument } from "./consolidate-notes";
import { extractConceptCoverage } from "./concept-coverage";
import { findUnrepresentedDeckPages } from "./source-coverage";
import { UNIFIED_NOTES_RULES } from "@/lib/ai/tutor-notes-quality";

/**
 * DEDUPLICATE REPETITION, NOT INFORMATION.
 *
 * Everything here is synthetic and subject-neutral. Each unique fact carries
 * a unique two-word marker so retention can be asserted exactly; the deck
 * generator deliberately re-states every concept's definition on every
 * revisit (the redundancy we DO want removed) while adding new facts in
 * parallel sentence structures (the content we must NOT lose).
 */

// ── Fixture ────────────────────────────────────────────────────────────────

const CONCEPTS = [
  "Kappa relay",
  "Lambda buffer",
  "Sigma gate",
  "Theta cycle",
  "Omega ledger",
  "Delta window",
  "Rho filter",
  "Zeta pool",
];

const WORDS = [
  "granite", "velvet", "harbor", "lantern", "meadow", "copper", "ember", "willow",
  "saffron", "cobalt", "timber", "quartz", "orchid", "falcon", "cedar", "marble",
  "ivory", "juniper", "onyx", "pebble", "raven", "sable", "tundra", "umber",
  "violet", "walnut", "yarrow", "zephyr", "amber", "basalt", "coral", "dune",
  "fennel", "garnet", "hazel", "indigo", "jasper", "kelp", "linen", "maple",
  "nectar", "opal", "pine", "quill", "ripple", "slate", "tulip", "ultramarine",
];

type Unit = { sectionId: string; markdown: string; markers: string[] };

const DEFINITIONS = [
  (c: string) => `- **${c}:** Coordinates the hand-off between the input stage and the processing stage.`,
  (c: string) => `- **${c}** is the component that coordinates the hand-off between the input and processing stages.`,
  (c: string) => `- **${c}:** The component coordinating hand-off from input stage to processing stage.`,
  (c: string) => `- The **${c}** coordinates the hand-off between input and processing.`,
  (c: string) => `- **${c}:** Coordinates the hand-off between the input stage and the processing stage (recap).`,
  (c: string) => `- **${c}** — coordinates hand-off between the input stage and the processing stage.`,
];

const HEADINGS = [
  (c: string) => `## ${c}`,
  (c: string) => `## ${c}: mechanism`,
  (c: string) => `## More on the ${c.toLowerCase()}`,
  (c: string) => `## ${c} examples`,
  (c: string) => `## ${c} — exceptions and evidence`,
  (c: string) => `## ${c} in practice`,
];

type Kind =
  | "mechanism" | "stage" | "number" | "example" | "exception" | "evidence"
  | "emphasis" | "table" | "steps" | "qualification" | "short";

const REVISITS: Kind[][] = [
  ["mechanism", "short"],
  ["stage", "number"],
  ["example", "qualification"],
  ["exception", "evidence"],
  ["emphasis", "table"],
  ["steps", "mechanism"],
];

function factLines(kind: Kind, c: string, m: string): string[] {
  const lc = c.toLowerCase();
  switch (kind) {
    case "mechanism":
      return [`- **Mechanism:** The ${lc} works by binding the ${m} signal before the hand-off completes.`];
    case "stage":
      return [`- **Stage:** During the ${m} stage the ${lc} holds the input until the processing side is idle.`];
    case "number":
      return [`- The ${lc} times out after 40 ms unless the ${m} flag is set.`];
    case "example":
      return [
        `- **Example:** A ${m} request passes through the ${lc} twice.`,
        `  - The second pass only happens when the first result was rejected.`,
      ];
    case "exception":
      return [`- **Exception:** The ${lc} is bypassed entirely for ${m} inputs.`];
    case "evidence":
      return [`- **Evidence:** The ${m} study measured a 12% drop in hand-off failures once the ${lc} was enabled.`];
    case "emphasis":
      return [`- **Why it matters:** The ${lc} ${m} case is a frequent exam question.`];
    case "table":
      return [`| Setting | ${c} behaviour |`, `| --- | --- |`, `| ${m} | Holds input |`, `| default | Passes input |`];
    case "steps":
      return [`1. Arm the ${lc} with the ${m} profile.`, `2. Send one input and wait for the hand-off.`, `3. Read the ${lc} status register.`];
    case "qualification":
      // Same start as the definition, new tail: must yield the UNION.
      return [`- **${c}:** Coordinates the hand-off between the input stage and the processing stage, and also throttles bursts using the ${m} policy.`];
    case "short":
      return [`- Skipped for ${m} runs.`];
  }
}

function buildDeck(revisits = 5): Unit[] {
  let mi = 0;
  const marker = () => {
    const a = WORDS[mi % WORDS.length]!;
    const b = WORDS[(Math.floor(mi / WORDS.length) + 7 + mi) % WORDS.length]!;
    mi += 1;
    return `${a} ${b}`;
  };
  const units: Unit[] = [];
  let n = 0;
  for (let r = 0; r <= revisits; r++) {
    for (const c of CONCEPTS) {
      n += 1;
      const lines = [HEADINGS[r % HEADINGS.length]!(c)];
      const markers: string[] = [];
      if (r === 0) {
        lines.push(DEFINITIONS[0]!(c));
        const m1 = marker();
        lines.push(`  - Introduced first because everything downstream depends on the ${m1} order.`);
        markers.push(m1);
        const m2 = marker();
        lines.push(`- **Purpose:** Prevents the processing stage from reading a half-written ${m2} record.`);
        markers.push(m2);
      } else {
        lines.push(DEFINITIONS[r % DEFINITIONS.length]!(c)); // redundant re-definition
        for (const kind of REVISITS[(r - 1) % REVISITS.length]!) {
          const m = marker();
          lines.push(...factLines(kind, c, m));
          markers.push(m);
        }
      }
      units.push({ sectionId: `u-${String(n).padStart(2, "0")}`, markdown: lines.join("\n"), markers });
    }
  }
  return units;
}

function lost(text: string, markers: string[]): string[] {
  const low = text.toLowerCase();
  return markers.filter((m) => !low.includes(m));
}
const join = (ss: Array<{ markdown: string }>) => ss.map((s) => s.markdown).join("\n");
const bodyLines = (ss: Array<{ markdown: string }>) =>
  ss.flatMap((s) => s.markdown.split("\n")).filter((l) => l.trim() && !/^#{1,6}\s/.test(l)).length;

// ── New-information check ──────────────────────────────────────────────────

test("lineAddsNewInformation: rewording is not new; numbers, names, parallel facts are", () => {
  const base = "- **Alpha process:** Starts the workflow and validates the input.";
  // Pure restatements.
  assert.equal(lineAddsNewInformation(base, "- The alpha process validates the input and starts the workflow."), false);
  assert.equal(lineAddsNewInformation(base, "- **Alpha process** is the stage that validates input and starts the workflow."), false);
  assert.equal(lineAddsNewInformation(base, "- Alpha process: starts the workflow and validates the input (recap)."), false);
  // New information.
  assert.equal(lineAddsNewInformation(base, "- **Alpha process:** Starts the workflow and validates the input within 40 ms."), true, "number");
  assert.equal(lineAddsNewInformation(base, "- **Alpha process:** Starts the workflow and validates the input per the Northwind spec."), true, "named term");
  assert.equal(lineAddsNewInformation(base, "- **Alpha process:** Starts the workflow, validates the input, and throttles bursts."), true, "extra clause");
  assert.equal(
    lineAddsNewInformation(
      "- **Mechanism:** The kappa relay works by binding the granite signal before the hand-off completes.",
      "- **Mechanism:** The lambda buffer works by binding the velvet signal before the hand-off completes."
    ),
    true,
    "parallel structure about a different thing"
  );
  // Short line, one new word: uncertain ⇒ counts as new (keep).
  assert.equal(lineAddsNewInformation("- Skipped for weekend runs.", "- Skipped for holiday runs."), true);
});

test("a flipped negation or a changed unit is a different fact, not a rewording", () => {
  const cases: Array<[string, string]> = [
    ["- The gamma ledger is reversible once committed.", "- The gamma ledger is not reversible once committed."],
    ["- Delta window has a retry budget.", "- Delta window has no retry budget."],
    ["- The iota bus is shared.", "- The iota bus isn't shared."],
    ["- The eta cache holds 4 KB per entry.", "- The eta cache holds 4 MB per entry."],
    ["- Give 3 mg every 40 ms.", "- Give 3 g every 40 ms."],
  ];
  for (const [a, b] of cases) {
    assert.equal(lineAddsNewInformation(a, b), true, `adds: ${b}`);
    assert.equal(isRepeatedNoteLine(a, b), false, `repeat: ${b}`);
    const intra = dedupeSectionLines(`## T\n${a}\n${b}`);
    assert.ok(intra.includes(a) && intra.includes(b), `intra-section lost one of: ${a} / ${b}`);
    const strip = stripLinesAlreadyCovered(`## X\n${b}`, [{ sectionId: "a", markdown: `## Topic\n${a}` }]);
    assert.ok(strip.includes(b.replace(/^- /, "")), `live guard dropped: ${b}`);
    const doc = join(consolidateNoteDocument([
      { sectionId: "a", markdown: `## Topic\n${a}` },
      { sectionId: "b", markdown: `## Topic again\n${b}` },
    ]).sections);
    assert.ok(doc.includes(a.replace(/^- /, "")) && doc.includes(b.replace(/^- /, "")), `document lost one of: ${a} / ${b}`);
  }
  // A short word after a number that is not a unit does not block a real repeat.
  assert.equal(lineAddsNewInformation("- Holds 3 of the frames.", "- Holds 3 frames."), false);
});

test("repeated line / definition predicates require near-equivalent meaning", () => {
  const a = "- **Beta gate:** Checks the input size before anything else runs.";
  assert.equal(isRepeatedNoteLine(a, "- The beta gate checks the input size before anything else runs."), true);
  // Longer line that CONTAINS the earlier one is never a repeat of it.
  const richer = "- **Beta gate:** Checks the input size before anything else runs, rejecting oversize payloads.";
  assert.equal(isRepeatedNoteLine(a, richer), false);
  assert.equal(laterLineSupersedes(a, richer), true);
  assert.equal(laterLineSupersedes(richer, a), false);
  // Two definitions of the same label: repeat only when the later adds nothing.
  assert.equal(isRepeatedDefinition(a, "- **Beta gate** is the check on input size that runs before anything else."), true);
  assert.equal(isRepeatedDefinition(a, "- **Beta gate:** Checks the input size before anything else runs and logs a Sentinel event."), false);
  // High overlap, different object ⇒ different fact.
  assert.equal(
    isRepeatedNoteLine("- **Exception:** The rho filter is bypassed entirely for granite inputs.",
      "- **Exception:** The zeta pool is bypassed entirely for velvet inputs."),
    false
  );
});

// ── Partial overlap ⇒ union ────────────────────────────────────────────────

test("partial overlap yields the union of facts, never the intersection", () => {
  const first = {
    sectionId: "p-1",
    markdown: "## Topic\n- The kappa relay validates the input, checks the size limit, and stamps the arrival time.",
  };
  const second = {
    sectionId: "p-2",
    markdown: "## Topic again\n- The kappa relay checks the size limit, stamps the arrival time, signs the record, and forwards it to the ledger.",
  };
  const res = consolidateNoteDocument([first, second]);
  const text = join(res.sections);
  for (const fact of ["validates the input", "checks the size limit", "stamps the arrival time", "signs the record", "forwards it to the ledger"]) {
    assert.ok(text.includes(fact), `missing: ${fact}`);
  }
});

test("a later definition that adds a clause upgrades the owner losslessly (supersedes)", () => {
  const owner = { sectionId: "o", markdown: "## Topic A\n- **Alpha process:** Starts the workflow and validates the input.\n- **Beta gate:** Checks the input size." };
  const later = {
    sectionId: "l",
    markdown: "## Topic A revisited\n- **Alpha process:** Starts the workflow and validates the input, retrying twice on transient errors.\n- **Gamma rule:** Applies after alpha.",
  };
  const res = consolidateRepeatedExplanations([owner, later]);
  const o = res.sections.find((s) => s.sectionId === "o")!;
  const l = res.sections.find((s) => s.sectionId === "l")!;
  assert.match(o.markdown, /retrying twice on transient errors/);
  assert.equal(join(res.sections).split("retrying twice").length - 1, 1, "exactly one copy");
  assert.match(l.markdown, /Gamma rule/);
});

test("richer-wording upgrade never drops tokens the owner line had", () => {
  const owner = { sectionId: "o", markdown: "## Topic A\n- **Alpha process:** Starts the workflow and validates the input." };
  const later = {
    sectionId: "l",
    markdown: "## Topic A again\n- **Alpha process:** Essentially the thing that gets everything going and starts the workflow, as they say.\n- **Delta step:** New.",
  };
  const res = consolidateRepeatedExplanations([owner, later]);
  assert.match(join(res.sections), /validates the input/);
});

// ── Within-section and fold primitives ─────────────────────────────────────

test("dedupeSectionLines collapses restatements but keeps parallel facts", () => {
  const md = [
    "## Topic",
    "- **Exception:** The rho filter is bypassed entirely for granite inputs.",
    "- **Exception:** The rho filter is bypassed entirely for velvet inputs.",
    "- The rho filter is bypassed for granite inputs entirely.",
    "- Times out after 40 ms.",
    "- Times out after 80 ms.",
  ].join("\n");
  const out = dedupeSectionLines(md);
  assert.match(out, /granite/);
  assert.match(out, /velvet/);
  assert.equal(out.split("granite").length - 1, 1, "restatement collapsed");
  assert.match(out, /40 ms/);
  assert.match(out, /80 ms/);
});

test("uniqueIncomingNoteLines keeps a longer line that contains an existing one", () => {
  const existing = "## T\n- **Beta gate:** Checks the input size before anything else runs.";
  const extra = uniqueIncomingNoteLines(
    existing,
    "- **Beta gate:** Checks the input size before anything else runs, rejecting oversize payloads."
  );
  assert.match(extra, /rejecting oversize payloads/);
  // …and the pump's fold then keeps exactly the richer copy.
  const folded = applySurgicalNoteRevision(existing, extra).markdown;
  assert.match(folded, /rejecting oversize payloads/);
  assert.equal(folded.split("Checks the input size").length - 1, 1);
});

test("isCorrectedNoteLine: a parallel fact about a different thing is not a 'correction'", () => {
  assert.equal(
    isCorrectedNoteLine(
      "- **Mechanism:** The kappa relay works by binding the granite signal before the hand-off completes.",
      "- **Mechanism:** The lambda buffer works by binding the velvet signal before the hand-off completes."
    ),
    false
  );
  // Genuine narrow fixes still patch in place.
  assert.equal(isCorrectedNoteLine("- Give 1 mg every 3 minutes.", "- Give 1.5 mg every 3 minutes."), true);
  assert.equal(isCorrectedNoteLine("- The sigma gait checks the input size.", "- The sigma gate checks the input size."), true);
});

// ── Section-level guarantees ───────────────────────────────────────────────

test("sections about different things are never merged on body similarity", () => {
  const a = {
    sectionId: "a",
    markdown: "## Lambda buffer: mechanism\n- **Lambda buffer:** Coordinates the hand-off between the input stage and the processing stage.\n- **Mechanism:** The lambda buffer works by binding the onyx signal before the hand-off completes.\n- Skipped for walnut runs.",
  };
  const b = {
    sectionId: "b",
    markdown: "## Sigma gate: mechanism\n- **Sigma gate:** Coordinates the hand-off between the input stage and the processing stage.\n- **Mechanism:** The sigma gate works by binding the raven signal before the hand-off completes.\n- Skipped for zephyr runs.",
  };
  assert.deepEqual(findDuplicateTopicGroups([a, b]), []);
  assert.ok(sectionCoveredRatio(a.markdown, b.markdown) < 0.9);
  const res = consolidateNoteDocument([a, b]);
  assert.equal(res.sections.length, 2);
  assert.deepEqual(res.removeSectionIds, []);
});

test("a section is removed only when every body line is already said elsewhere", () => {
  const owner = { sectionId: "o", markdown: "## Topic A\n- **Alpha process:** Starts the workflow and validates the input.\n- **Beta gate:** Checks the input size." };
  const pureRepeat = { sectionId: "r", markdown: "## Recap\n- The alpha process validates the input and starts the workflow.\n- Beta gate checks the input size." };
  const mostlyRepeat = { sectionId: "m", markdown: "## Recap 2\n- The alpha process validates the input and starts the workflow.\n- The beta gate rejects payloads above 4 KB." };
  const res = consolidateNoteDocument([owner, pureRepeat, mostlyRepeat]);
  assert.ok(res.removeSectionIds.includes("r"), "pure repeat removed");
  assert.equal(res.removeSectionIds.includes("m"), false, "section with a unique fact kept");
  assert.match(join(res.sections), /above 4 KB/);
  assert.deepEqual(findUncoveredLines(pureRepeat.markdown, [owner]), []);
});

test("a student-owned owner cannot absorb nested details, so the repeated parent keeps them", () => {
  const owner = {
    sectionId: "o",
    studentEdited: true,
    markdown: "## Alpha gate\n- **Alpha gate:** Coordinates the hand-off between the input stage and the processing stage.",
  };
  const later = {
    sectionId: "l",
    markdown: [
      "## Alpha gate again",
      "- **Alpha gate:** Coordinates the hand-off between the input stage and the processing stage.",
      "  - Only the granite variant supports a 3-way hand-off.",
      "  - The velvet variant times out after 40 ms.",
      "- **Exception:** Skipped for harbor payloads.",
    ].join("\n"),
  };
  for (const text of [join(consolidateRepeatedExplanations([owner, later]).sections), join(consolidateNoteDocument([owner, later]).sections)]) {
    assert.match(text, /granite variant/);
    assert.match(text, /40 ms/);
    assert.match(text, /harbor payloads/);
  }
  // With an AI-owned owner the children fold into it and the repeat is removed.
  const aiOwner = { ...owner, studentEdited: false };
  const res = consolidateRepeatedExplanations([aiOwner, later]);
  const o = res.sections.find((s) => s.sectionId === "o")!;
  assert.match(o.markdown, /granite variant/);
  assert.equal(join(res.sections).split("Coordinates the hand-off").length - 1, 1);
});

test("semantic trim never offers a parallel fact about another established concept", () => {
  const secs = [
    { sectionId: "a", markdown: "## Alpha gate\n- **Alpha gate:** Holds the granite record until the downstream side is idle.\n- **Consequence:** Disabling the alpha gate doubles coral latency.\n- **Stage 1:** During the lantern phase the alpha gate buffers input." },
    { sectionId: "b", markdown: "## Beta relay\n- **Beta relay:** Holds the velvet record until the downstream side is idle.\n- **Consequence:** Disabling the beta relay doubles dune latency.\n- **Stage 1:** During the meadow phase the beta relay buffers input." },
  ];
  const cands = findSemanticTrimCandidates(secs);
  const offered = cands.flatMap((c) => c.later.flatMap((l) => l.lines.map((x) => x.text)));
  assert.deepEqual(offered.filter((t) => /dune|meadow/.test(t)), [], `offered: ${offered.join(" | ")}`);
  // Worst case (model drops everything offered) still keeps every fact.
  const trims = cands.flatMap((cd) => cd.later.map((l) => ({ sectionId: l.sectionId, dropLineNumbers: l.lines.map((x) => x.n) })));
  const text = join(applySemanticTrims(secs, trims, cands).sections);
  for (const m of ["coral", "dune", "lantern", "meadow", "granite", "velvet"]) assert.ok(text.includes(m), `lost ${m}`);
});

test("navigation strip removes 'see above for the …' and 'only new details here' fragments", () => {
  const out = stripEditorialNavigationLines(
    [
      "## Alpha gate again",
      "- See above for the definition; only new details here.",
      "- See above for details, the granite variant is skipped.",
      "- The velvet variant times out after 40 ms (only new details here).",
    ].join("\n")
  );
  assert.equal(containsEditorialNavigation(out), false, out);
  assert.doesNotMatch(out, /only new details here/i);
  assert.doesNotMatch(out, /^- For the definition/m);
  assert.match(out, /granite variant is skipped/);
  assert.match(out, /velvet variant times out after 40 ms/);
});

test("mergeDuplicateGroup keeps every unique line of absorbed sections", () => {
  const keep = { sectionId: "k", markdown: "## Kappa relay\n- **Kappa relay:** Coordinates the hand-off between the input stage and the processing stage." };
  const absorb = [
    { sectionId: "x", markdown: "## Kappa relay: mechanism\n- **Kappa relay** coordinates the hand-off between input and processing.\n- **Mechanism:** Binds the granite signal first.\n- Times out after 40 ms unless the velvet flag is set." },
    { sectionId: "y", markdown: "## Kappa relay examples\n- **Example:** A harbor request passes through the kappa relay twice.\n  - The second pass only happens when the first result was rejected.\n| Setting | Behaviour |\n| --- | --- |\n| lantern | Holds input |" },
  ];
  const merged = mergeDuplicateGroup({ keep, absorb });
  for (const f of ["granite", "40 ms", "velvet", "harbor", "second pass", "| lantern | Holds input |"]) {
    assert.ok(merged.markdown.includes(f), `missing: ${f}`);
  }
  assert.equal(merged.markdown.split("Coordinates the hand-off").length - 1 + merged.markdown.split("coordinates the hand-off").length - 1, 1, "definition once");
});

test("structural bold lead-ins are not tracked as concepts", () => {
  const cov = extractConceptCoverage([
    { sectionId: "a", markdown: "## Topic\n- **Mechanism:** Binds the signal first.\n- **Stage:** Holds input.\n- **Evidence:** A study.\n- **Kappa relay:** Coordinates the hand-off." },
  ]);
  const keys = new Set(cov.concepts.map((c) => c.key));
  assert.equal(keys.has("mechanism"), false);
  assert.equal(keys.has("stage"), false);
  assert.equal(keys.has("evidence"), false);
  assert.ok(keys.has("kappa relay"));
});

// ── The big one: a 48-unit deck through every deterministic stage ──────────

test("48-unit synthetic deck: repeated definitions collapse, every unique fact survives every stage", () => {
  const deck = buildDeck(5);
  const markers = deck.flatMap((u) => u.markers);
  assert.equal(deck.length, 48);
  assert.ok(markers.length >= 90);

  // (b) live pump guard, one new section per unit.
  const pump: Array<{ sectionId: string; markdown: string }> = [];
  for (const u of deck) {
    const fresh = stripLinesAlreadyCovered(u.markdown, pump);
    if (fresh.split("\n").some((l) => l.trim() && !/^#{1,3}\s/.test(l.trim()))) {
      pump.push({ sectionId: u.sectionId, markdown: fresh });
    }
  }
  assert.deepEqual(lost(join(pump), markers), [], "stripLinesAlreadyCovered lost facts");

  // (b2) live pump with fold classification + surgical revise.
  const folded: Array<{ sectionId: string; markdown: string }> = [];
  for (const u of deck) {
    for (const act of classifyAppendChunks(u.markdown, folded)) {
      if (act.kind === "fold") {
        const idx = folded.findIndex((s) => s.sectionId === act.sectionId);
        const cleaned = stripLinesAlreadyCovered(act.markdown, folded.filter((s) => s.sectionId !== act.sectionId));
        if (!cleaned.trim()) continue;
        folded[idx] = { ...folded[idx]!, markdown: dedupeSectionLines(applySurgicalNoteRevision(folded[idx]!.markdown, cleaned).markdown) };
      } else {
        const fresh = stripLinesAlreadyCovered(act.markdown, folded);
        if (fresh.split("\n").some((l) => l.trim() && !/^#{1,3}\s/.test(l.trim()))) {
          folded.push({ sectionId: u.sectionId, markdown: fresh });
        }
      }
    }
  }
  assert.deepEqual(lost(join(folded), markers), [], "pump fold path lost facts");

  // (c) cross-section repeated explanations.
  const c = consolidateRepeatedExplanations(deck);
  assert.deepEqual(lost(join(c.sections), markers), [], "consolidateRepeatedExplanations lost facts");
  assert.ok(c.changed, "the redundant re-definitions must actually be removed");

  // (d) wrap-up same-topic merge.
  let d = deck.map((u) => ({ sectionId: u.sectionId, markdown: u.markdown }));
  for (const g of findDuplicateTopicGroups(d)) {
    const merged = mergeDuplicateGroup(g);
    const rm = new Set(merged.removeSectionIds);
    d = d.filter((s) => !rm.has(s.sectionId)).map((s) => (s.sectionId === merged.sectionId ? { ...s, markdown: merged.markdown } : s));
  }
  assert.deepEqual(lost(join(d), markers), [], "same-topic merge lost facts");
  assert.equal(d.length, CONCEPTS.length, "one section per concept after heading merge");

  // (e) the shared full pipeline, and (e2) pump output → full pipeline.
  const e = consolidateNoteDocument(deck);
  assert.deepEqual(lost(join(e.sections), markers), [], "consolidateNoteDocument lost facts");
  const e2 = consolidateNoteDocument(folded);
  assert.deepEqual(lost(join(e2.sections), markers), [], "pump → consolidateNoteDocument lost facts");

  // Redundancy really was removed: 40 revisits each re-stated the definition.
  assert.ok(bodyLines(e.sections) <= bodyLines(deck) - 40, `expected ≥40 repeated lines removed, got ${bodyLines(deck) - bodyLines(e.sections)}`);
  const text = join(e.sections).toLowerCase();
  for (const cpt of CONCEPTS) {
    const defs = text.split(`${cpt.toLowerCase()}`).length - 1;
    assert.ok(defs >= 1);
  }
  // Plain re-definitions (no added clause) collapse to one per concept; the
  // "qualification" line (definition + new clause) legitimately survives.
  const plainDefs = join(e.sections)
    .split("\n")
    .filter((l) => /coordinat(?:es|ing) (?:the )?hand-off/i.test(l) && !/throttles bursts/.test(l)).length;
  assert.equal(plainDefs, CONCEPTS.length, `plain definitions should be one per concept, got ${plainDefs}`);
  // Tables survive the merge intact (header, separator, rows).
  for (const s of e.sections) {
    const rows = s.markdown.split("\n").filter((l) => /^\s*\|/.test(l));
    if (rows.length === 0) continue;
    assert.ok(rows.some((r) => /^\s*\|\s*-{3}/.test(r)), `table separator lost in ${s.sectionId}:\n${s.markdown}`);
  }

  // (f) semantic pass, worst case: the model asks to drop every offered line.
  const cands = findSemanticTrimCandidates(e.sections);
  const trims = cands.flatMap((cd) => cd.later.map((l) => ({ sectionId: l.sectionId, dropLineNumbers: l.lines.map((x) => x.n) })));
  const f = applySemanticTrims(e.sections, trims, cands);
  const lostF = lost(join(f.sections), markers);
  assert.ok(lostF.length <= Math.ceil(markers.length * 0.02), `semantic worst case lost ${lostF.length}: ${lostF.join(", ")}`);

  // Deck coverage report: every substantive page is represented.
  const pages = deck.map((u, i) => ({ pageNum: i + 1, title: u.markdown.split("\n")[0]!.replace(/^##\s+/, ""), extractedText: u.markdown }));
  assert.deepEqual(findUnrepresentedDeckPages(pages, join(e.sections)), []);
});

test("semantic trim JSON parses even when the model wraps it in fences and adds reasoning", () => {
  const later = {
    sectionId: "s-r",
    markdown: "## Later\n- **Alpha process** is the stage that validates the input and starts the workflow.",
  };
  const owner = { sectionId: "s-o", markdown: "## Topic A\n- **Alpha process:** Starts the workflow and validates the input." };
  const candidates = findSemanticTrimCandidates([owner, later]);
  const reply = [
    "```json",
    '{ "trims": [ { "sectionId": "s-r", "dropLineNumbers": [2] } ] }',
    "```",
    "",
    "**Reasoning:** Line 2 restates the owner {definition} with no new information.",
  ].join("\n");
  const trims = parseSemanticTrimJson(reply, candidates);
  assert.deepEqual(trims, [{ sectionId: "s-r", dropLineNumbers: [2] }]);
  assert.deepEqual(parseSemanticTrimJson("no json here", candidates), []);
});

test("deck coverage report flags substantive pages with no footprint in the notes", () => {
  const pages = [
    { pageNum: 1, title: "Agenda", extractedText: "Today: intro, overview, questions." },
    { pageNum: 2, title: "Kappa relay", extractedText: "Kappa relay coordinates the hand-off between the input stage and the processing stage; binds the granite signal; times out after 40 ms." },
    { pageNum: 3, title: "Omega ledger", extractedText: "The omega ledger records every committed hand-off with a monotonic sequence number, a checksum, and the originating window identifier for later audit." },
  ];
  const notes = "## Kappa relay\n- **Kappa relay:** Coordinates the hand-off between the input stage and the processing stage.\n- Binds the granite signal; times out after 40 ms.";
  const missing = findUnrepresentedDeckPages(pages, notes);
  assert.deepEqual(missing.map((m) => m.pageNum), [3]);
});

// ── Prompts must not turn coverage into a content cap ──────────────────────

test("prompt text: coverage means 'don't repeat background', never 'write less'", () => {
  assert.match(UNIFIED_NOTES_RULES, /Produce comprehensive study notes representing ALL meaningful unique information/);
  assert.match(UNIFIED_NOTES_RULES, /not unique educational content/);
  assert.match(UNIFIED_NOTES_RULES, /not what is "done"/);
  assert.match(UNIFIED_NOTES_RULES, /DO add every new fact/);
  assert.match(UNIFIED_NOTES_RULES, /When unsure whether something is new, include it/);
  assert.doesNotMatch(UNIFIED_NOTES_RULES, /\b(virus|cell|enzyme|accounting|treaty|derivative)\b/i);

  assert.match(REPEATED_EXPLANATIONS_JOB_RULES, /effectively ZERO information loss/);
  for (const item of ["fact the owner lacks", "distinct example", "different angle", "mechanism", "qualification", "number, unit, name, date, stage, relationship", "instructor context"]) {
    assert.ok(REPEATED_EXPLANATIONS_JOB_RULES.includes(item), `checklist item missing: ${item}`);
  }
  assert.match(REPEATED_EXPLANATIONS_JOB_RULES, /Same concept is NOT the same content/);
  assert.match(REPEATED_EXPLANATIONS_JOB_RULES, /When uncertain, keep/);
  assert.match(SEMANTIC_TRIM_INSTRUCTION, /effectively zero information/);
  assert.match(SEMANTIC_TRIM_INSTRUCTION, /When uncertain, keep/);

  // The live/seed prompt module is server-only; check its source text.
  const src = readFileSync(path.join(process.cwd(), "src/lib/ai/live-lecture-notes.ts"), "utf8");
  assert.doesNotMatch(src, /SUMMARIZE as you go/);
  assert.match(src, /condense wording, never information/);
  assert.match(src, /never a cap on how much/);
  assert.match(src, /applies to the rolling summary only — never to the notes themselves/);
  assert.match(src, /Leave @@append empty ONLY when every sentence of the slice restates/);
  assert.doesNotMatch(src, /If the slice only REPEATS already-captured material → leave @@append empty/);
  for (const file of ["src/lib/ai/generate-mentored-notes.ts", "src/lib/ai/synthesize-tutor-notes.ts"]) {
    const s = readFileSync(path.join(process.cwd(), file), "utf8");
    assert.match(s, /established background, not finished topics/, file);
    assert.match(s, /DO (write|capture) every new fact/, file);
  }
});

// ── Formula / definition guards (measured failures on a dense chemistry deck) ─

test("formulas: different equations are different facts even when their tokens match", () => {
  // Variables are single letters the tokenizer drops; only the math signature tells these apart.
  assert.equal(
    lineAddsNewInformation("- $\\Delta G° = -RT \\ln K$", "  $$\\Delta G = \\Delta G° + RT \\ln Q$$"),
    true
  );
  assert.equal(
    lineAddsNewInformation(
      "- The rate law is $\\text{rate} = k[\\text{NO}]^2[\\text{O}_2]$.",
      "- The overall rate law is $\\text{rate} = k[\\text{NO}]^2[\\text{Br}_2]$."
    ),
    true
  );
  // Same equation, different wrapping / emphasis: still a repeat.
  assert.equal(
    lineAddsNewInformation("- ΔG = ΔH − TΔS", "**ΔG = ΔH − TΔS**."),
    false
  );
  assert.equal(
    isRepeatedNoteLine("- $\\Delta G° = -RT \\ln K$ at equilibrium.", "- At equilibrium $\\Delta G = \\Delta G° + RT \\ln Q$ holds."),
    false
  );
});

test("semantic trim veto: new equation, concept definition, or a third novel content is never zero-loss", () => {
  const owners = [
    "The **rate-determining step** (RDS) is the slowest elementary step in a mechanism; it limits the overall rate.",
    "- **Heterogeneous catalysts** are in a different phase from the reactants; the mechanism involves adsorption, reaction, and desorption.",
  ];
  const definition =
    "A **mechanism** is the sequence of elementary steps that describes how a reaction proceeds at the molecular level.";
  assert.equal(semanticTrimClearlyLosesInformation(owners, definition, "mechanism"), true);
  assert.equal(semanticTrimClearlyLosesInformation(owners, definition), true); // ≥ 1/3 novel tokens
  assert.equal(
    semanticTrimClearlyLosesInformation(
      ["A **rate law** expresses the rate as a function of concentrations; example: rate = k[NO]²[O₂]."],
      "The overall rate law is rate = k[NO]²[Br₂], consistent with experiment."
    ),
    true
  );
  // Possessive names count as named terms ("Hess's law").
  assert.equal(
    semanticTrimClearlyLosesInformation(
      ["**Enthalpy** is defined as H = U + PV; at constant pressure ΔH = qp."],
      "Because enthalpy is a **state function**, the change for an overall reaction is the sum of its steps. This is **Hess's law**."
    ),
    true
  );
  // A pure rewording still passes through to the model's judgement.
  assert.equal(
    semanticTrimClearlyLosesInformation(
      ["- **Osmosis** is the diffusion of water across a selectively permeable membrane."],
      "- Osmosis: water diffuses across a selectively permeable membrane."
    ),
    false
  );
});

test("same-topic merge keeps a facet section's heading as a sub-heading (organization merged, structure kept)", () => {
  const keep = {
    sectionId: "k",
    markdown: "## Price Elasticity of Demand\n- **PED** measures the % change in quantity demanded for a 1% change in price.",
  };
  const absorb = [
    {
      sectionId: "d",
      markdown:
        "## Determinants of Price Elasticity\n- **Substitutes:** more substitutes → more elastic (butter vs. margarine).\n- **Time horizon:** gasoline ≈ 0.25 short run, ≈ 0.6 over 5+ years.",
    },
    {
      sectionId: "o",
      markdown: "## Price elasticity of demand (overview)\n- PED measures the percentage change in quantity demanded for a 1% price change.",
    },
  ];
  assert.equal(headingsAreSameTitle(keep.markdown.split("\n")[0]!.slice(3), "Price elasticity of demand (overview)"), true);
  assert.equal(headingsAreSameTitle("Price Elasticity of Demand", "Determinants of Price Elasticity"), false);
  const groups = findDuplicateTopicGroups([keep, ...absorb]);
  assert.equal(groups.length, 1);
  const merged = mergeDuplicateGroup(groups[0]!);
  assert.match(merged.markdown, /^### Determinants of Price Elasticity$/m);
  assert.match(merged.markdown, /butter vs\. margarine/);
  assert.match(merged.markdown, /0\.6 over 5\+ years/);
  // The reworded same-title copy folds in without a sub-heading or a second definition.
  assert.doesNotMatch(merged.markdown, /^### Price elasticity of demand/m);
  assert.equal((merged.markdown.match(/1% (?:change in )?price/g) ?? []).length, 1);
  assert.deepEqual(merged.removeSectionIds.sort(), ["d", "o"]);
});
