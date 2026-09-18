import assert from "node:assert/strict";
import test from "node:test";
import { isOverCutRevision, selectDeckExcerptFor } from "@/lib/live-notes/review-guards";

test("over-cut guard: a narrow fix keeps the section; dropping many lines is rejected", () => {
  const original = [
    "## Enzymes",
    "- Enzymes lower activation energy.",
    "- Km is the substrate concentration at half Vmax.",
    "- Competitive inhibitors raise apparent Km.",
    "- Noncompetitive inhibitors lower Vmax.",
    "- Taq polymerase is stable at 95 °C.",
  ].join("\n");
  const narrowFix = original.replace("95 °C", "95 °C (Thermus aquaticus)");
  assert.equal(isOverCutRevision(original, narrowFix), false);
  const oneLineDropped = original.split("\n").slice(0, -1).join("\n");
  assert.equal(isOverCutRevision(original, oneLineDropped), false);
  const halfGone = original.split("\n").slice(0, 3).join("\n");
  assert.equal(isOverCutRevision(original, halfGone), true);
  assert.equal(isOverCutRevision("## T\n- only line", "## T"), true);
});

test("deck excerpt picks the pages relevant to the batch instead of the first N chars", () => {
  const pages = Array.from({ length: 40 }, (_, i) => {
    const n = i + 1;
    const body =
      n === 33
        ? "Arrhenius equation k = A e^(−Ea/RT); a plot of ln k vs 1/T gives slope −Ea/R."
        : `Slide ${n} discusses topic number ${n} with filler text about unrelated matters and more words to pad it out considerably.`;
    return `[slide ${n}] Title ${n}\n${body}`;
  });
  const deck = pages.join("\n\n");
  const excerpt = selectDeckExcerptFor(
    "## Arrhenius\n- k = A e^(−Ea/RT); ln k vs 1/T gives slope −Ea/R.",
    deck,
    1_200
  );
  assert.ok(excerpt.includes("[slide 33]"), excerpt);
  assert.ok(excerpt.length <= 1_200);
  // Short decks pass through whole.
  assert.equal(selectDeckExcerptFor("anything", "[slide 1] A\nshort", 5_000), "[slide 1] A\nshort");
});
