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
import { consolidateNoteDocument } from "@/lib/notes/consolidate-notes";

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

// ── Subject neutrality: humanities / CS headers, agendas, dated facts ─────

test("cross-listed course title, 'Today' agenda, and 'Next week' slides are NON-SUBSTANTIVE in any subject", () => {
  const ledger = buildSourceCoverageLedger([
    unit("1", "HIST 240 / ECON 215 — The Great Depression: Causes, Course, and Consequences\nDr. Amara Sethi\nWeek 6"),
    unit("2", "Today\n1. Thorndike and Skinner\n2. Reinforcement and punishment\n3. Schedules"),
    unit("3", "CS 201 — Lecture 7: Sorting and Asymptotic Analysis\nInstructor: Dr. Wen Zhao\nHomework 3 due Friday"),
    unit("4", "PSYC 210 — Lecture 9: Operant Conditioning\nProf. L. Marchetti\nReading: Ch. 6, pp. 188–214"),
    unit("5", "Next week: World War II economies\nReading: Ch. 8"),
  ]);
  for (const u of ledger.units) {
    assert.equal(u.kind, "non-substantive", `${u.unit.id}: ${u.contributions.map((c) => c.text).join(" / ")}`);
  }
});

test("dated statements are facts, not citations; reference shapes still ride along with the previous fact", () => {
  const ledger = buildSourceCoverageLedger([
    unit(
      "6",
      "Timeline\nOctober 29, 1929 (\"Black Tuesday\"): the Dow fell 12% in one day.\nBritain leaves the gold standard, 1931.\nThe Journal of Commerce wrote in 1929 that prices fell 40%."
    ),
    unit(
      "7",
      "Evidence\nCountries that left gold earlier recovered sooner.\nEichengreen (1992)\nChimpanzees worked for poker chips exchangeable for grapes.\nWolfe, 1936"
    ),
  ]);
  const six = ledger.units[0]!;
  const texts6 = six.contributions.map((c) => c.text);
  assert.ok(texts6.some((t) => /Black Tuesday/.test(t)));
  assert.ok(texts6.some((t) => /gold standard, 1931/.test(t)), "dated event is a contribution");
  assert.ok(texts6.some((t) => /Journal of Commerce wrote/.test(t)), "sentence with a verb is a fact");
  const seven = ledger.units[1]!;
  const texts7 = seven.contributions.map((c) => c.text);
  assert.equal(texts7.length, 2, texts7.join(" / "));
  assert.match(texts7[0]!, /\(Eichengreen \(1992\)\)\.$/);
  assert.match(texts7[1]!, /\(Wolfe, 1936\)\.$/);
});

test("tables without digits (complexity classes) are audited row by row", () => {
  const ledger = buildSourceCoverageLedger([
    unit(
      "16",
      "Table 2. Comparison of sorting algorithms\nAlgorithm\tBest\tWorst\tStable?\nMerge sort\tΘ(n log n)\tΘ(n log n)\tYes\nQuicksort\tΘ(n log n)\tΘ(n²)\tNo\nCounting sort\tΘ(n + k)\tΘ(n + k)\tYes"
    ),
  ]);
  const rows = ledger.units[0]!.contributions.map((c) => c.text);
  assert.ok(rows.some((r) => r.startsWith("Quicksort |")), rows.join(" / "));
  assert.ok(rows.some((r) => r.startsWith("Counting sort |")), rows.join(" / "));
  const audit = auditSourceCoverage(ledger, [
    sec("s1", "## Sorting\n- Merge sort: Θ(n log n) best and worst, stable.\n- Quicksort: Θ(n log n) best, Θ(n²) worst, not stable."),
  ]);
  const u = audit.units[0]!;
  assert.equal(u.status, "missing");
  assert.ok(u.missing.some((m) => /Counting sort/.test(m.text)), "the row the notes skipped is the missing delta");
  assert.ok(!u.missing.some((m) => /^Quicksort/.test(m.text)));
});

// ── G. multi-file upload (library level: live sessions hold one deck) ─────

test("G: two uploaded files — file B's repeated definitions are REDUNDANT, only B's unique facts are restored, ranges work with non-numeric ids", () => {
  const inflDef = "Inflation is a sustained rise in the general price level, measured by the percentage change in a price index.";
  const cpiDef = "The consumer price index (CPI) tracks the cost of a fixed basket of goods bought by a typical urban household.";
  const A: SourceUnit[] = [
    { id: "A-1", order: 0, sourceId: "A", label: "Inflation", text: inflDef },
    { id: "A-2", order: 1, sourceId: "A", label: "CPI", text: cpiDef },
    { id: "A-3", order: 2, sourceId: "A", label: "Fisher equation", text: "The Fisher equation: real interest rate ≈ nominal rate − expected inflation." },
    { id: "A-4", order: 3, sourceId: "A", label: "Costs", text: "Menu costs are the costs of changing posted prices; shoe-leather costs are the time spent economizing on cash." },
  ];
  const B: SourceUnit[] = [
    { id: "B-1", order: 4, sourceId: "B", label: "Recap", text: inflDef },
    { id: "B-2", order: 5, sourceId: "B", label: "Recap", text: `${inflDef}\n${cpiDef}` },
    { id: "B-3", order: 6, sourceId: "B", label: "Core inflation", text: "Core inflation excludes food and energy prices because they are volatile; in 2022 US headline CPI inflation peaked at 9.1% while core peaked at 6.6%." },
    { id: "B-4", order: 7, sourceId: "B", label: "Hyperinflation", text: "Hyperinflation is conventionally defined as inflation above 50% per month (Cagan, 1956); Zimbabwe's monthly rate reached 79.6 billion percent in November 2008." },
    { id: "B-5", order: 8, sourceId: "B", label: "Indexation", text: "Indexation links wages or benefits to a price index; US Social Security payments have been indexed to CPI-W since 1975." },
  ];
  const ledger = buildSourceCoverageLedger([...A, ...B]);
  assert.deepEqual(
    ledger.units.map((u) => [u.unit.id, u.unit.sourceId]),
    [["A-1", "A"], ["A-2", "A"], ["A-3", "A"], ["A-4", "A"], ["B-1", "B"], ["B-2", "B"], ["B-3", "B"], ["B-4", "B"], ["B-5", "B"]]
  );
  // Notes cover file A completely and only a paraphrase of A's definitions from B.
  const notes = [
    sec("s-infl", `## Inflation\n\n${inflDef}\n- ${cpiDef}\n- **Fisher equation:** real interest rate ≈ nominal rate − expected inflation.`),
    sec("s-costs", "## Costs of Inflation\n\n- **Menu costs** are the costs of changing posted prices.\n- **Shoe-leather costs** are the time spent economizing on cash."),
    sec("s-recap", `## Recap\n\n${inflDef}\n- ${cpiDef}`),
  ];
  const before = auditSourceCoverage(ledger, notes);
  const status = Object.fromEntries(before.units.map((u) => [u.unitId, u.status]));
  assert.deepEqual(status, {
    "A-1": "covered", "A-2": "covered", "A-3": "covered", "A-4": "covered",
    "B-1": "redundant", "B-2": "redundant", "B-3": "missing", "B-4": "missing", "B-5": "missing",
  });
  // Contiguous gap B-3..B-5 detected by source ORDER, not by parsing digits out of ids.
  assert.deepEqual(before.missingRanges.map((r) => r.ids), [["B-3", "B-4", "B-5"]]);
  assert.match(formatSourceCoverageAudit(before), /missing ranges: B-3–B-5/);
  const summary = summarizeSourceCoverageAudit(before);
  assert.deepEqual(summary.missingRanges, [{ from: "B-3", to: "B-5" }]);
  assert.deepEqual(summary.missingUnitIds, ["B-3", "B-4", "B-5"]);

  // Full deterministic wrap-up: consolidate (drops the duplicated recap), then repair.
  const c = consolidateNoteDocument(notes.map((s) => ({ sectionId: s.sectionId, markdown: s.markdown, studentEdited: s.studentEdited })));
  let working = notes.map((s) => ({ ...s }));
  for (const r of c.revisions) { const live = working.find((w) => w.sectionId === r.sectionId); if (live) live.markdown = r.markdown; }
  working = working.filter((w) => !c.removeSectionIds.includes(w.sectionId));
  const result = repairSourceCoverage(ledger, working);
  assert.equal(result.after.counts.missing, 0, formatSourceCoverageAudit(result.after));
  const doc = result.sections.map((s) => s.markdown).join("\n");
  // Only B's unique facts were added, in source wording, once each.
  for (const needle of ["Core inflation excludes food and energy", "9.1%", "6.6%", "above 50% per month", "79.6 billion percent", "indexed to CPI-W since 1975"]) {
    assert.equal((doc.match(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length, 1, needle);
  }
  // A's definitions were NOT re-inserted from B: the whole document states each once.
  assert.equal((doc.match(/sustained rise in the general price level/g) ?? []).length, 1);
  assert.equal((doc.match(/cost of a fixed basket of goods/g) ?? []).length, 1);
  assert.ok(result.repairs.every((r) => r.unitIds.every((id) => id.startsWith("B-"))), JSON.stringify(result.repairs.map((r) => r.unitIds)));
});
