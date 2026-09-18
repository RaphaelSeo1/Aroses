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
