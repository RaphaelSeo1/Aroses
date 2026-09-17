import assert from "node:assert/strict";
import test from "node:test";
import {
  buildConceptCoverageBlock,
  conceptKey,
  extractConceptCoverage,
  formatConceptCoverage,
  isDefinitionLine,
  lineMentionsConcept,
} from "./concept-coverage";

// Synthetic, subject-neutral fixtures ("Topic A / Topic B").
const sectionA = {
  sectionId: "s-a",
  markdown: [
    "## Topic A",
    "The alpha process is the first stage of the workflow.",
    "- **Alpha process:** Starts the workflow and validates the input.",
    "  - Runs once per request.",
    "  - Fails when the input is empty.",
    "- **Beta gate:** Checks the input size before anything else runs.",
    "- **Why it matters:** Exam questions often ask which stage runs first.",
  ].join("\n"),
};

const sectionB = {
  sectionId: "s-b",
  markdown: [
    "## Topic B",
    "- **Gamma rule:** Applies after the alpha process completes.",
    "- The beta gate result decides whether the gamma rule runs.",
    "- **Open question:** Notes had 3 stages; later said 4 stages. Which is right?",
  ].join("\n"),
};

test("concept key merges plural/case/punctuation variants", () => {
  assert.equal(conceptKey("Alpha Processes:"), conceptKey("alpha process"));
  assert.equal(conceptKey("**Beta gate**"), "beta gate");
});

test("definition detection uses shape, not vocabulary", () => {
  assert.equal(
    isDefinitionLine("- **Alpha process:** Starts the workflow.", "Alpha process"),
    true
  );
  assert.equal(
    isDefinitionLine("The alpha process is the first stage.", "Alpha process"),
    true
  );
  assert.equal(
    isDefinitionLine("- Fails when the alpha process sees empty input.", "Alpha process"),
    false
  );
  // Works for a formula-style label too (math/CS shaped content).
  assert.equal(
    isDefinitionLine("- **Delta ratio:** output divided by input.", "Delta ratio"),
    true
  );
});

test("lineMentionsConcept requires the whole phrase", () => {
  assert.equal(lineMentionsConcept("the beta gate result", "beta gate"), true);
  assert.equal(lineMentionsConcept("the beta version shipped", "beta gate"), false);
});

test("coverage: states, ownership and mentions across sections", () => {
  const cov = extractConceptCoverage([sectionA, sectionB]);
  const byLabel = new Map(cov.concepts.map((c) => [c.key, c]));

  const alpha = byLabel.get("alpha process")!;
  assert.equal(alpha.state, "defined");
  assert.equal(alpha.ownerSectionId, "s-a");
  assert.deepEqual(alpha.mentionedIn, ["s-a", "s-b"]);
  assert.ok(alpha.facts.length >= 1);

  const beta = byLabel.get("beta gate")!;
  assert.equal(beta.state, "defined");
  assert.equal(beta.ownerSectionId, "s-a");

  const gamma = byLabel.get("gamma rule")!;
  assert.equal(gamma.state, "defined");
  assert.equal(gamma.ownerSectionId, "s-b");

  // Structural labels are never tracked as concepts.
  assert.equal(byLabel.has("why matter"), false);
  assert.equal(byLabel.has("open question"), false);

  assert.equal(cov.openQuestions.length, 1);
  assert.equal(cov.openQuestions[0]!.sectionId, "s-b");
});

test("coverage: a bare mention stays 'mentioned' until a later section explains it", () => {
  const first = {
    sectionId: "s-1",
    markdown: "## Intro\n- We will come back to the **omega factor** later in the course.",
  };
  const second = {
    sectionId: "s-2",
    markdown:
      "## Details\n- **Omega factor:** The scaling constant that multiplies the base rate.\n  - Always positive.\n  - Measured once per batch.",
  };
  const only = extractConceptCoverage([first]);
  assert.equal(only.concepts.find((c) => c.key === "omega factor")!.state, "mentioned");

  const both = extractConceptCoverage([first, second]);
  const omega = both.concepts.find((c) => c.key === "omega factor")!;
  assert.equal(omega.state, "defined");
  assert.equal(omega.ownerSectionId, "s-2", "ownership moves to the first real explanation");
});

test("format: relevant concepts first, bounded, with state + fact", () => {
  const cov = extractConceptCoverage([sectionA, sectionB]);
  const block = formatConceptCoverage(cov, {
    relevanceText: "now the gamma rule kicks in after the process",
    maxChars: 600,
  });
  const lines = block.split("\n");
  assert.ok(lines[0]!.includes("Gamma rule"), `expected gamma first, got: ${lines[0]}`);
  assert.match(block, /DEFINED \+ EXPLAINED in \[s-a\] Topic A/);
  assert.match(block, /UNRESOLVED in \[s-b\]/);
  assert.ok(block.length <= 600);
});

test("format: empty document yields empty block", () => {
  assert.equal(buildConceptCoverageBlock([]), "");
});

test("works across subject shapes (history dates, math formulas, code terms)", () => {
  const cov = extractConceptCoverage([
    {
      sectionId: "h",
      markdown:
        "## Treaty timeline\n- **Treaty of Example:** Signed in 1648; ended the long conflict.\n  - Two parties, one mediator.",
    },
    {
      sectionId: "m",
      markdown:
        "## Rates\n- **Growth rate:** r = (final − initial) / initial.\n- The growth rate is compared each quarter.",
    },
    {
      sectionId: "c",
      markdown:
        "## Data structures\n- **Hash map:** Stores key→value pairs with O(1) average lookup.",
    },
  ]);
  const keys = new Set(cov.concepts.map((c) => c.key));
  assert.ok(keys.has("treaty example"));
  assert.ok(keys.has("growth rate"));
  assert.ok(keys.has("hash map"));
  for (const c of cov.concepts) {
    if (["treaty example", "growth rate", "hash map"].includes(c.key)) {
      assert.equal(c.state, "defined");
    }
  }
});
