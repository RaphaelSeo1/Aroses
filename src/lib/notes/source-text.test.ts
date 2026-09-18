import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeSourceText,
  repairLigatureSplits,
  segmentSourceText,
} from "@/lib/notes/source-text";

test("ligature splits from PDF extraction are repaired", () => {
  assert.equal(
    repairLigatureSplits("CONDENSINs were \tfi rst identi\tfi ed as high-molecular weight"),
    "CONDENSINs were first identified as high-molecular weight"
  );
  assert.equal(repairLigatureSplits("Di ff erences in a fl atworm"), "Differences in a flatworm");
});

test("hard-wrapped sentences are re-joined; diagram labels and bare numbers stay separate", () => {
  const segs = segmentSourceText(
    [
      "Widely-spaced crossovers",
      "1\t>1",
      "During meiosis, DNA double-strand breaks (DSBs) are deliberately",
      "induced in DNA to start recombination",
      "Homolog pairing",
      "Crossover recombination is essential to hold homologous chromosomes together so that they can segregate",
      "away from each other. At least one DSB, but usually only 1-2 DSBs, is/are repaired as crossovers.",
    ].join("\n")
  );
  assert.ok(segs.includes("Widely-spaced crossovers"), segs.join(" | "));
  assert.ok(!segs.some((s) => /crossovers 1/.test(s)), segs.join(" | "));
  assert.ok(
    segs.includes("During meiosis, DNA double-strand breaks (DSBs) are deliberately induced in DNA to start recombination"),
    segs.join(" | ")
  );
  assert.ok(segs.some((s) => s.startsWith("At least one DSB, but usually only 1-2 DSBs")));
});

test("tab-separated table rows stay one row; separate text boxes on one visual row split", () => {
  const norm = normalizeSourceText("Singapore\tAf\t26\t28\t2,340\nLamina\tINM\tNuclear Envelope");
  assert.equal(norm.split("\n")[0], "Singapore | Af | 26 | 28 | 2,340");
  assert.deepEqual(norm.split("\n").slice(1), ["Lamina", "INM", "Nuclear Envelope"]);
});

// ── Subject-neutral table + abbreviation handling ─────────────────────────

test("a table whose cells have no digits is still kept as rows (consecutive lines, same cell count)", () => {
  const norm = normalizeSourceText(
    "Table 2. Comparison\nAlgorithm\tBest\tWorst\tStable?\nMerge sort\tΘ(n log n)\tΘ(n log n)\tYes\nQuicksort\tΘ(n log n)\tΘ(n²)\tNo"
  );
  const lines = norm.split("\n");
  assert.ok(lines.includes("Merge sort | Θ(n log n) | Θ(n log n) | Yes"));
  assert.ok(lines.includes("Quicksort | Θ(n log n) | Θ(n²) | No"));
  // Rows never fuse with their neighbours when segmented.
  const segs = segmentSourceText(
    "Algorithm\tBest\tWorst\tStable?\nMerge sort\tΘ(n log n)\tΘ(n log n)\tYes\nQuicksort\tΘ(n log n)\tΘ(n²)\tNo"
  );
  assert.ok(segs.includes("Quicksort | Θ(n log n) | Θ(n²) | No"));
  assert.ok(!segs.some((s) => /Yes Quicksort/.test(s)));
  // A lone row of three plain labels is still diagram text, not a table.
  assert.deepEqual(normalizeSourceText("Lamina\tINM\tNuclear envelope").split("\n"), [
    "Lamina",
    "INM",
    "Nuclear envelope",
  ]);
});

test("reference abbreviations do not split a sentence (Ch., pp., Vol., Sec.)", () => {
  assert.deepEqual(segmentSourceText("Reading: Ch. 6, pp. 188–214."), ["Reading: Ch. 6, pp. 188–214."]);
  assert.deepEqual(segmentSourceText("See Vol. 2, Sec. 4 for the proof. The theorem follows."), [
    "See Vol. 2, Sec. 4 for the proof.",
    "The theorem follows.",
  ]);
});

test("uppercase abbreviations that spell a ligature (FI, FL, FF) are never glued", () => {
  assert.equal(
    repairLigatureSplits("On an FI schedule the record scallops (a 60-s FI gives a longer pause)."),
    "On an FI schedule the record scallops (a 60-s FI gives a longer pause)."
  );
  assert.equal(repairLigatureSplits("The FL office and the FF dynamic marking"), "The FL office and the FF dynamic marking");
  // Real lowercase ligature fragments still repair.
  assert.equal(repairLigatureSplits("identi fi ed in the fi rst trial"), "identified in the first trial");
});
