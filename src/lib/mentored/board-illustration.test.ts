import assert from "node:assert/strict";
import test from "node:test";
import {
  illustrationForChunk,
  illustrationPrompt,
  pictureBrief,
  revealFraction,
} from "./board-illustration.ts";

const SCIENCE = {
  title: "Chemiosmosis",
  brief:
    "A horizontal cell membrane holds protein complexes I, II, III, and IV. Complexes I, III, and IV pump protons, shown as small dots, into the space above the membrane. A gold turbine-shaped ATP synthase sits in the membrane on the right.",
  labels: ["I", "II", "III", "IV", "ATP synthase", "Matrix"],
};

const HISTORY = {
  title: "The Stamp Act",
  brief:
    "In a colonial port in 1765, a tax stamp is pressed onto a newspaper. Colonists refuse the stamped paper and stand together in a boycott.",
  labels: ["Stamp Act", "Boycott", "1765"],
};

test("picture briefs stay short and drop empty text", () => {
  assert.equal(pictureBrief("  too short  "), undefined);
  assert.equal(
    pictureBrief("  A membrane with complexes and a turbine.  "),
    "A membrane with complexes and a turbine."
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
    concept: "Chemiosmosis",
    explanation:
      "Complexes I, III, and IV pump protons across the membrane, and that gradient turns ATP synthase.",
    analogy:
      "Picture water held behind a dam. As it rushes through, it spins a turbine. That turbine is ATP synthase.",
    keyPoints: ["proton gradient", "ATP synthase"],
    illustrationBrief:
      "A membrane with complexes I, II, III, IV and a gold ATP synthase turbine.",
    analogyIllustration:
      "Water held behind a dam rushes through and spins a turbine.",
  };
  const teaching = illustrationForChunk(chunk, 0);
  const analogy = illustrationForChunk(chunk, 1);
  assert.equal(teaching?.kicker, "Whiteboard");
  assert.match(teaching?.brief ?? "", /membrane/);
  assert.equal(analogy?.kicker, "New analogy");
  assert.match(analogy?.brief ?? "", /dam/);
  assert.equal((analogy?.brief ?? "").includes("complexes"), false);
});

test("science and history prompts ask for different illustrated objects", () => {
  const science = illustrationPrompt(SCIENCE);
  const history = illustrationPrompt(HISTORY);
  assert.match(science, /ATP synthase/);
  assert.match(science, /protein complexes/);
  assert.match(history, /boycott/i);
  assert.match(history, /1765/);
  assert.equal(science.includes("Stamp Act"), false);
  assert.equal(history.includes("ATP synthase"), false);
  assert.match(science, /only words allowed/);
  assert.match(science, /not a flowchart/);
});
