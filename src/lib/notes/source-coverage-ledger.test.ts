import assert from "node:assert/strict";
import test from "node:test";
import {
  auditSourceCoverage,
  buildSourceCoverageLedger,
  formatSourceCoverageAudit,
  repairSourceCoverage,
  summarizeSourceCoverageAudit,
  type CoverageNoteSection,
} from "@/lib/notes/source-coverage-ledger";
import type { SourceUnit } from "@/lib/notes/source-coverage";

const unit = (id: string, text: string, label?: string, sourceId?: string): SourceUnit => ({
  id,
  order: Number.parseInt(id.replace(/\D/g, ""), 10) || 0,
  text,
  label: label ?? text.split("\n")[0]!,
  sourceId,
});

const sec = (sectionId: string, markdown: string, studentEdited = false): CoverageNoteSection => ({
  sectionId,
  markdown,
  studentEdited,
});

// ── Ledger: contributions, not concept names ──────────────────────────────

test("ledger tracks each informational contribution of a unit, in source order", () => {
  const ledger = buildSourceCoverageLedger([
    unit("1", "Concept X\nConcept X is a regulated process that runs in three stages."),
    unit("2", "Structure of X\nConcept X is a regulated process that runs in three stages.\nX has a core of two subunits joined by a hinge."),
    unit("3", "Mechanism of X\nThe hinge closes when ATP binds, pulling the subunits together."),
  ]);
  assert.equal(ledger.units.length, 3);
  assert.deepEqual(
    ledger.units.map((u) => u.contributions.filter((c) => c.introducedHere).length),
    [1, 1, 1]
  );
  // The repeated definition on unit 2 is attributed to unit 1.
  const repeat = ledger.units[1]!.contributions.find((c) => !c.introducedHere);
  assert.ok(repeat);
  assert.equal(repeat!.introducedBy, "1");
  assert.deepEqual(ledger.units.map((u) => u.unit.order), [1, 2, 3]);
});

test("topic overlap is not coverage: defining X does not cover its structure or mechanism", () => {
  const ledger = buildSourceCoverageLedger([
    unit("1", "Concept X\nConcept X is a regulated process that runs in three stages."),
    unit("2", "Structure of X\nX has a core of two subunits joined by a hinge."),
    unit("3", "Mechanism of X\nThe hinge closes when ATP binds, pulling the subunits together."),
  ]);
  const notes = [sec("a", "## Concept X\n- **Concept X** is a regulated process that runs in three stages.")];
  const audit = auditSourceCoverage(ledger, notes);
  assert.deepEqual(
    audit.units.map((u) => u.status),
    ["covered", "missing", "missing"]
  );
  assert.equal(audit.counts.missing, 2);
  assert.deepEqual(audit.missingRanges.map((r) => r.ids), [["2", "3"]]);
});

test("a unit that only repeats earlier units is REDUNDANT, not missing", () => {
  const ledger = buildSourceCoverageLedger([
    unit("1", "Passive transport\nPassive transport moves substances down their concentration gradient without ATP."),
    unit("2", "Review\nPassive transport moves substances down their concentration gradient without ATP."),
  ]);
  const audit = auditSourceCoverage(ledger, [
    sec("a", "## Transport\n- **Passive transport** moves substances down their concentration gradient without ATP."),
  ]);
  assert.deepEqual(audit.units.map((u) => u.status), ["covered", "redundant"]);
});

test("numbers are mandatory: a paraphrase that drops the figure is not coverage", () => {
  const ledger = buildSourceCoverageLedger([
    unit("1", "Pump\nThe sodium-potassium pump exports 3 Na+ and imports 2 K+ per ATP hydrolyzed."),
  ]);
  const missing = auditSourceCoverage(ledger, [
    sec("a", "## Pump\n- The sodium-potassium pump exports sodium and imports potassium using ATP."),
  ]);
  assert.equal(missing.units[0]!.status, "missing");
  const covered = auditSourceCoverage(ledger, [
    sec("a", "## Pump\n- **Na+/K+ pump:** exports 3 Na+ and imports 2 K+ per ATP hydrolyzed."),
  ]);
  assert.equal(covered.units[0]!.status, "covered");
});

// ── Unit classification ────────────────────────────────────────────────────

test("title, agenda, and questions slides are NON-SUBSTANTIVE; label-only diagrams are VISUAL-ONLY", () => {
  const ledger = buildSourceCoverageLedger([
    unit("1", "BIOL 101 — Lecture 4: Membranes\nDr. Okafor"),
    unit("2", "Today's agenda\n1. Membrane structure\n2. Passive transport\n3. Active transport"),
    unit("3", "Passive transport"),
    unit("4", "Lamina\nINM\nONM\nSUN protein\nKASH protein\nChromosome"),
    unit("5", "(Slide 5 — little selectable text; mostly visual.)"),
    unit("6", "Questions?"),
  ]);
  assert.deepEqual(
    ledger.units.map((u) => u.kind),
    ["non-substantive", "non-substantive", "non-substantive", "visual-only", "visual-only", "non-substantive"]
  );
  const audit = auditSourceCoverage(ledger, []);
  assert.equal(audit.counts.missing, 0);
  assert.deepEqual(audit.visualOnlyUnitIds, ["4", "5"]);
});

test("tables and equations are substantive data, not decoration", () => {
  const ledger = buildSourceCoverageLedger([
    unit("1", "Table 2. Sample stations\nStation\tKöppen\tJan (°C)\tJul (°C)\tAnnual precip (mm)\nSingapore\tAf\t26\t28\t2,340\nMoscow\tDfb\t−7\t19\t700"),
    unit("2", "First law\nΔU = q + w: the change in internal energy equals heat added plus work done on the system.\nPressure–volume work: w = −PextΔV."),
  ]);
  assert.equal(ledger.units[0]!.kind, "substantive");
  assert.ok(ledger.units[0]!.contributions.some((c) => c.text.includes("Singapore | Af | 26")));
  assert.equal(ledger.units[1]!.kind, "substantive");
  const audit = auditSourceCoverage(ledger, [
    sec("a", "## Köppen\n| Station | Köppen | Jan | Jul | Precip |\n| --- | --- | --- | --- | --- |\n| Singapore | Af | 26 | 28 | 2,340 |\n| Moscow | Dfb | −7 | 19 | 700 |"),
    sec("b", "## First law\n- **ΔU = q + w** — internal energy change = heat added + work done on the system.\n- Pressure–volume work: w = −PextΔV."),
  ]);
  assert.equal(audit.counts.missing, 0, formatSourceCoverageAudit(audit));
});

test("figure captions / construct labels and a bare number under a title are labels, not sentences", () => {
  const ledger = buildSourceCoverageLedger([
    unit("1", "pachytene\n50X real time\nmCherry::histone ZYG-12::GFP\nLINC complexes undergo large-scale motions along the nuclear envelope during early meiotic prophase."),
    unit("2", "Widely-spaced crossovers\n1\t>1\nDuring meiosis, DNA double-strand breaks (DSBs) are deliberately induced in DNA."),
  ]);
  const texts = ledger.units.flatMap((u) => u.contributions.map((c) => c.text));
  assert.ok(texts.every((t) => !t.includes("::")), texts.join(" | "));
  assert.ok(texts.every((t) => !/crossovers 1$/.test(t)), texts.join(" | "));
  assert.equal(ledger.units[0]!.contributions.length, 1);
  assert.equal(ledger.units[1]!.contributions.length, 1);
});

// ── Repair ─────────────────────────────────────────────────────────────────

test("repair inserts only the missing delta, into the best AI section, in source wording; re-audit is clean", () => {
  const ledger = buildSourceCoverageLedger([
    unit("1", "Condensin\nCondensin is a regulated process that runs in three stages."),
    unit("2", "Structure of condensin\nCondensin has a core of two subunits joined by a hinge."),
    unit("3", "Mechanism of condensin\nThe condensin hinge closes when ATP binds, pulling the subunits together."),
    unit("4", "Evidence\nIn 2018 cryo-EM resolved the closed condensin hinge at 3.2 Å."),
  ]);
  const notes = [
    sec("a", "## Condensin\n- **Condensin** is a regulated process that runs in three stages.\n- Condensin has a core of two subunits joined by a hinge."),
    sec("b", "## Unrelated topic\n- Something else entirely about budgets and quarterly targets."),
  ];
  const result = repairSourceCoverage(ledger, notes);
  assert.equal(result.before.counts.missing, 2);
  assert.equal(result.after.counts.missing, 0, formatSourceCoverageAudit(result.after));
  const a = result.sections.find((s) => s.sectionId === "a")!;
  // The delta lands in the owner section (heading + body overlap), not a new one.
  assert.match(a.markdown, /hinge closes when ATP binds/);
  assert.match(a.markdown, /cryo-EM resolved the closed condensin hinge at 3\.2 Å/);
  assert.equal(result.sections.length, 2);
  // Only the delta: the already-present lines are not duplicated.
  assert.equal((a.markdown.match(/two subunits joined by a hinge/g) ?? []).length, 1);
  // Unrelated section untouched.
  assert.equal(result.sections.find((s) => s.sectionId === "b")!.markdown, notes[1]!.markdown);
  // Nothing invented: every restored line is a source sentence.
  for (const r of result.repairs) {
    for (const line of r.markdown.split("\n")) {
      const t = line.replace(/^- /, "").replace(/^## .*/, "").trim();
      if (!t) continue;
      assert.ok(
        ledger.contributions.some((c) => t.toLowerCase().startsWith(c.text.toLowerCase().slice(0, 20))),
        `restored line not from source: ${t}`
      );
    }
  }
});

test("student-edited sections count as coverage but are never repair targets", () => {
  const ledger = buildSourceCoverageLedger([
    unit("1", "Osmosis\nOsmosis is the diffusion of water across a selectively permeable membrane."),
    unit("2", "Aquaporins\nAquaporins increase water permeability roughly 10-fold."),
  ]);
  const notes = [
    sec("mine", "## Osmosis (my notes)\n- Osmosis is the diffusion of water across a selectively permeable membrane.", true),
  ];
  const result = repairSourceCoverage(ledger, notes);
  assert.equal(result.before.units[0]!.status, "covered");
  assert.equal(result.before.units[1]!.status, "missing");
  assert.equal(result.after.counts.missing, 0);
  // The student's section is byte-identical; the delta went to a new AI section.
  assert.equal(result.sections.find((s) => s.sectionId === "mine")!.markdown, notes[0]!.markdown);
  const added = result.sections.filter((s) => s.sectionId !== "mine");
  assert.equal(added.length, 1);
  assert.match(added[0]!.markdown, /^## /);
  assert.match(added[0]!.markdown, /10-fold/);
});

test("contiguous missing ranges are detected in source order even when the notes are reorganized", () => {
  const units = Array.from({ length: 10 }, (_, i) =>
    unit(String(i + 1), `Topic ${i + 1}\nStage ${i + 1} of the pathway converts substrate S${i + 1} into product P${i + 1} using enzyme E${i + 1}.`)
  );
  const ledger = buildSourceCoverageLedger(units);
  // Notes cover 1–5 and 10, reordered.
  const notes = [
    sec("late", "## Stage 10\n- Stage 10 of the pathway converts substrate S10 into product P10 using enzyme E10."),
    sec("early", "## Stages 1–5\n" + [1, 2, 3, 4, 5].map((i) => `- Stage ${i} converts substrate S${i} into product P${i} using enzyme E${i}.`).join("\n")),
  ];
  const audit = auditSourceCoverage(ledger, notes);
  assert.deepEqual(audit.missingRanges.map((r) => [r.ids[0], r.ids[r.ids.length - 1]]), [["6", "9"]]);
  const summary = summarizeSourceCoverageAudit(audit);
  assert.deepEqual(summary.missingRanges, [{ from: "6", to: "9" }]);
  const result = repairSourceCoverage(ledger, notes);
  assert.equal(result.after.counts.missing, 0);
});

test("multi-source ledger: units from two files keep their source id and are audited together", () => {
  const ledger = buildSourceCoverageLedger([
    { id: "A-1", order: 1, sourceId: "A", label: "Intro", text: "Enzymes lower activation energy without being consumed." },
    { id: "A-2", order: 2, sourceId: "A", label: "Km", text: "Km is the substrate concentration at half of Vmax." },
    { id: "B-1", order: 3, sourceId: "B", label: "Recap", text: "Enzymes lower activation energy without being consumed." },
    { id: "B-2", order: 4, sourceId: "B", label: "Inhibition", text: "Competitive inhibitors raise the apparent Km without changing Vmax." },
  ]);
  const audit = auditSourceCoverage(ledger, [
    sec("a", "## Enzymes\n- Enzymes lower activation energy without being consumed.\n- **Km** is the substrate concentration at half of Vmax."),
  ]);
  assert.deepEqual(
    audit.units.map((u) => [u.unitId, u.sourceId, u.status]),
    [["A-1", "A", "covered"], ["A-2", "A", "covered"], ["B-1", "B", "redundant"], ["B-2", "B", "missing"]]
  );
  const result = repairSourceCoverage(ledger, [
    sec("a", "## Enzymes\n- Enzymes lower activation energy without being consumed.\n- **Km** is the substrate concentration at half of Vmax."),
  ]);
  assert.equal(result.after.counts.missing, 0);
  const doc = result.sections.map((s) => s.markdown).join("\n");
  assert.equal((doc.match(/Competitive inhibitors raise the apparent Km/g) ?? []).length, 1);
  // The shared definition from file B is not copied a second time.
  assert.equal((doc.match(/lower activation energy/g) ?? []).length, 1);
});
