import assert from "node:assert/strict";
import test from "node:test";
import {
  CHEMIOSMOSIS_SCENE,
  DAM_ANALOGY_SCENE,
  boardSceneSvg,
  parseBoardScene,
} from "./board-scene.ts";

test("chemiosmosis board draws complexes, protons, and ATP synthase", () => {
  const svg = boardSceneSvg(CHEMIOSMOSIS_SCENE);
  assert.match(svg, /<rect/);
  assert.match(svg, />I</);
  assert.match(svg, />II</);
  assert.match(svg, />III</);
  assert.match(svg, />IV</);
  assert.match(svg, />ATP</);
  assert.match(svg, /data-mark="dot"/);
  assert.match(svg, /data-mark="arrow"/);
  assert.match(svg, /Intermembrane space/);
  assert.match(svg, /Matrix/);
});

test("dam analogy is a different drawing", () => {
  const science = boardSceneSvg(CHEMIOSMOSIS_SCENE);
  const analogy = boardSceneSvg(DAM_ANALOGY_SCENE);
  assert.notEqual(science, analogy);
  assert.match(analogy, /NEW ANALOGY/);
  assert.match(analogy, /Water held back/);
  assert.match(analogy, /Turbine/);
  assert.match(analogy, />Dam</);
  assert.match(analogy, /data-mark="wave"/);
  assert.doesNotMatch(analogy, />I</);
  assert.doesNotMatch(analogy, /Intermembrane space/);
});

test("parseBoardScene keeps drawable marks and drops junk", () => {
  const scene = parseBoardScene({
    kicker: "Whiteboard",
    title: "Gradient",
    marks: [
      { kind: "box", x: 20, y: 40, w: 10, h: 16, text: "I", tone: "rose" },
      { kind: "nope", x: 1, y: 1 },
      { kind: "text", x: 50, y: 10, text: "Space" },
    ],
  });
  assert.ok(scene);
  assert.equal(scene.marks.length, 2);
  const svg = boardSceneSvg(scene);
  assert.match(svg, />I</);
  assert.match(svg, />Space</);
});
