import assert from "node:assert/strict";
import test from "node:test";
import { collectGapFillRepairs, pickGapPages } from "./seed-gap-fill";
import type { SourceCoverageAudit } from "@/lib/notes/source-coverage-ledger";

const sections = [
  { sectionId: "s-1", markdown: "## Supply and Demand\n\nPrices clear markets.\n- **Demand curve:** slopes down." },
  { sectionId: "s-2", markdown: "## Price Elasticity\n\n- **Elastic:** |e| > 1." },
];

let n = 0;
const mint = () => `s-new${++n}`;

test("gap fill: @@revise becomes an extend fragment with no H2", () => {
  const repairs = collectGapFillRepairs(
    [{ op: "revise", sectionId: "s-1", body: "## Supply and Demand\n- **Supply curve:** slopes up because marginal cost rises.\n  - Shifts right when input prices fall." }],
    sections,
    ["7"],
    mint
  );
  assert.equal(repairs.length, 1);
  assert.equal(repairs[0]!.kind, "extend");
  assert.equal(repairs[0]!.sectionId, "s-1");
  assert.doesNotMatch(repairs[0]!.markdown, /^##\s/m);
  assert.match(repairs[0]!.markdown, /Supply curve/);
  assert.match(repairs[0]!.markdown, /input prices fall/);
  assert.deepEqual(repairs[0]!.unitIds, ["7"]);
});

test("gap fill: @@append chunks fold into a same-heading section, else become new sections", () => {
  const repairs = collectGapFillRepairs(
    [
      {
        op: "append",
        sectionId: "s-app",
        body:
          "## Price Elasticity\n- **Inelastic:** |e| < 1, e.g. insulin.\n\n## Consumer Surplus\n\nThe gap between willingness to pay and price.\n- **Formula:** area under demand above price.",
      },
    ],
    sections,
    ["8", "9"],
    mint
  );
  const extend = repairs.find((r) => r.kind === "extend");
  const created = repairs.find((r) => r.kind === "new");
  assert.ok(extend && created);
  assert.equal(extend!.sectionId, "s-2");
  assert.match(extend!.markdown, /Inelastic/);
  assert.doesNotMatch(extend!.markdown, /^##\s/m);
  assert.match(created!.markdown, /^## Consumer Surplus/m);
  assert.match(created!.markdown, /willingness to pay/);
});

test("gap fill: unknown revise target and delete ops never lose or remove content", () => {
  const repairs = collectGapFillRepairs(
    [
      { op: "delete", sectionId: "s-1", body: "Prices clear markets." },
      { op: "revise", sectionId: "s-gone", body: "## Tax Incidence\n- **Burden:** falls on the less elastic side." },
      { op: "revise", sectionId: "s-1", body: "   \n" },
    ],
    sections,
    ["10"],
    mint
  );
  assert.equal(repairs.length, 1);
  assert.equal(repairs[0]!.kind, "new");
  assert.match(repairs[0]!.markdown, /Tax Incidence/);
});

test("gap fill: only MISSING pages are sent, in deck order, within the seed char cap", () => {
  const deck = [
    { pageNum: 1, title: "Title", extractedText: "Course title" },
    { pageNum: 2, title: "A", extractedText: "x".repeat(3_000) },
    { pageNum: 3, title: "B", extractedText: "y".repeat(3_000) },
    { pageNum: 4, title: "C", extractedText: "z".repeat(3_000) },
  ];
  const audit = {
    units: [
      { unitId: "1", status: "non-substantive" },
      { unitId: "2", status: "missing" },
      { unitId: "3", status: "covered" },
      { unitId: "4", status: "missing" },
    ],
  } as unknown as SourceCoverageAudit;
  const pages = pickGapPages(deck, audit);
  assert.deepEqual(pages.map((p) => p.pageNum), [2, 4]);
  const big = {
    units: [2, 3, 4].map((id) => ({ unitId: String(id), status: "missing" })),
  } as unknown as SourceCoverageAudit;
  assert.deepEqual(pickGapPages(deck, big).map((p) => p.pageNum), [2, 3]);
});
