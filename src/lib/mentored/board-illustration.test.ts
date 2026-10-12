import assert from "node:assert/strict";
import test from "node:test";
import {
  asksForVisualization,
  captionLine,
  clipPrompt,
  illustrationForChunk,
  illustrationForRequest,
  illustrationPrompt,
  motionFrameIndex,
  motionStageBriefs,
  pictureBrief,
  revealFraction,
} from "./board-illustration.ts";

const SHIFT = {
  title: "A tax shifts supply",
  brief:
    "A price axis and a quantity axis. A blue demand curve slopes down. A rose supply curve slopes up.",
  labels: ["Demand", "Supply", "Tax"],
};

const HISTORY = {
  title: "The Stamp Act",
  brief:
    "In a colonial port in 1765, a tax stamp is pressed onto a newspaper. Colonists refuse the stamped paper and stand together in a boycott.",
  labels: ["Stamp Act", "Boycott", "1765"],
};

test("the caption is the line being spoken", () => {
  assert.equal(
    captionLine("Protons flow across. The gradient builds.", "unused"),
    "The gradient builds."
  );
  assert.equal(captionLine("", "A tax shifts the supply curve."), "A tax shifts the supply curve.");
});

test("picture briefs stay short and drop empty text", () => {
  assert.equal(pictureBrief("  too short  "), undefined);
  assert.equal(
    pictureBrief("  A shop with fewer items on the shelf.  "),
    "A shop with fewer items on the shelf."
  );
});

test("a mid-teach moment is only part of the drawing", () => {
  const script = "a".repeat(100);
  assert.equal(revealFraction("", script, 0), 0.08);
  assert.ok(revealFraction("a".repeat(40), script, 0) > 0.35);
  assert.ok(revealFraction("a".repeat(40), script, 0) < 0.5);
  assert.equal(revealFraction("", script, 7_000), 0.5);
  assert.equal(revealFraction(script, script, 1_000), 1);
});

test("a missed check swaps in the analogy picture", () => {
  const chunk = {
    concept: "A tax shifts supply",
    explanation:
      "A tax raises the cost of selling, so the supply curve slides left and the price buyers pay goes up.",
    analogy:
      "Picture a shop that must pay a new fee on every item. Fewer items stay on the shelf.",
    keyPoints: ["supply shifts left", "price rises"],
    illustrationBrief:
      "A graph with a downward demand curve and an upward supply curve.",
    analogyIllustration:
      "A shop counter with fewer items on the shelf after a fee.",
    visualForm: "animation" as const,
    motion: "The supply curve slides left.",
    analogyVisualForm: "still" as const,
  };
  const teaching = illustrationForChunk(chunk, 0);
  const analogy = illustrationForChunk(chunk, 1);
  assert.equal(teaching?.kicker, "Whiteboard");
  assert.equal(teaching?.form, "animation");
  assert.match(teaching?.motion ?? "", /slides left/);
  assert.equal(analogy?.kicker, "New analogy");
  assert.equal(analogy?.form, "still");
  assert.match(analogy?.brief ?? "", /shop/);
  assert.equal((analogy?.brief ?? "").includes("demand curve"), false);
});

test("a moving figure advances to a later frame while it is taught", () => {
  assert.equal(motionFrameIndex(0.08, 3), 0);
  assert.equal(motionFrameIndex(0.5, 3), 1);
  assert.equal(motionFrameIndex(1, 3), 2);
  const stages = motionStageBriefs(
    "A graph with a demand curve and a supply curve.",
    "The supply curve slides left."
  );
  assert.equal(stages.length, 3);
  assert.match(stages[0], /starting position only/);
  assert.match(stages[2], /slides left/);
  assert.equal(stages[0] === stages[2], false);
});

test("a request to see the idea is recognized, and the picture stays on this concept", () => {
  assert.equal(asksForVisualization("show me a visualization"), true);
  assert.equal(asksForVisualization("can you draw this"), true);
  assert.equal(asksForVisualization("play a video of it"), true);
  assert.equal(asksForVisualization("그림으로 보여줘"), true);
  assert.equal(asksForVisualization("yes that makes sense"), false);
  assert.equal(asksForVisualization("show me the module"), false);
  const picture = illustrationForRequest({
    concept: "Half-equivalence point",
    explanation: "At the half-equivalence point, half of the weak base has become its conjugate acid.",
    keyPoints: ["moles of base equal moles of conjugate acid"],
    keyTerms: ["Half-equivalence point", "Limiting reactant"],
  });
  assert.match(picture?.brief ?? "", /conjugate acid/);
  assert.equal((picture?.labels ?? []).includes("Half-equivalence point"), false);
  assert.equal((picture?.labels ?? []).includes("Limiting reactant"), true);
});

test("a clip prompt describes motion and a still prompt does not reuse another subject", () => {
  const shift = illustrationPrompt(SHIFT);
  const history = illustrationPrompt(HISTORY);
  const clip = clipPrompt({
    ...SHIFT,
    motion: "The supply curve slides left.",
  });
  assert.match(shift, /supply curve/);
  assert.match(history, /boycott/i);
  assert.equal(shift.includes("Stamp Act"), false);
  assert.equal(history.includes("supply curve"), false);
  assert.match(clip, /slides left/);
  assert.match(clip, /continuous shot/);
});
