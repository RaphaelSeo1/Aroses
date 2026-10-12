import assert from "node:assert/strict";
import test from "node:test";
import {
  constrainScene,
  fallbackScene,
  parseSceneSpec,
  reconcileScene,
  renderBoardScene,
  stepOpacity,
} from "./board-scene-spec.ts";

const BOND = {
  title: "What a Chemical Bond Is",
  brief:
    "Two atoms sit side by side. A chemical bond is the force that holds them together, shown as electrons shared in the space between the atoms.",
  labels: ["chemical bonds", "forces that hold atoms together"],
};

const MEMBRANE = {
  title: "Chemiosmosis",
  brief:
    "The inner membrane holds the electron transport complexes. Protons are pumped across the membrane and flow back through ATP synthase.",
  labels: ["membrane", "complexes", "protons", "ATP synthase"],
};

const TAX = {
  title: "A tax shifts supply",
  brief:
    "A price axis and a quantity axis. Demand slopes down. Supply slopes up. A tax shifts the supply curve to the left.",
  labels: ["Demand", "Supply", "Tax"],
};

const STAMP = {
  title: "The Stamp Act",
  brief:
    "In 1765 a tax stamp is pressed onto a newspaper. Colonists refuse the stamped paper in a boycott.",
  labels: ["Stamp Act", "Boycott", "1765"],
};

test("algebra steps never share the board, and the last step holds", () => {
  const count = 3;
  for (let t = 0; t <= 1; t += 0.05) {
    const visible = [0, 1, 2].filter((index) => stepOpacity(index, count, t) === 1);
    assert.ok(visible.length <= 1, `two steps visible at ${t}`);
  }
  assert.equal(stepOpacity(0, count, 0.08), 1);
  assert.equal(stepOpacity(1, count, 0.08), 0);
  assert.equal(stepOpacity(2, count, 0.9), 1);
  assert.equal(stepOpacity(0, count, 0.9), 0);

  const svg = renderBoardScene({
    motion: "steps",
    glyphs: [],
    steps: ["2x + 3 = 11", "2x = 8", "x = 4"],
  });
  assert.match(svg, /2x \+ 3 = 11/);
  assert.match(svg, /x = 4/);
  assert.match(svg, /step2\{animation:step2 [^}]*forwards\}/);
});

test("every label is placed inside the frame", () => {
  const scenes = [BOND, MEMBRANE, TAX, STAMP].map((lesson) =>
    renderBoardScene(reconcileScene(null, lesson))
  );
  for (const svg of scenes) {
    const labels = [...svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)"[^>]*>([^<]*)<\/text>/g)];
    assert.ok(labels.length > 0);
    for (const match of labels) {
      const x = Number(match[1]);
      const y = Number(match[2]);
      assert.ok(x >= 20 && x <= 940, match[3]);
      assert.ok(y >= 20 && y <= 520, match[3]);
    }
  }
});

test("a chemical bond draws atoms sharing electrons, not a membrane", () => {
  const wrong = {
    motion: "flow" as const,
    glyphs: [
      { role: "complex" as const, label: "chemical bonds" },
      { role: "rotor" as const, label: "forces that hold atoms together" },
    ],
    steps: [],
  };
  const svg = renderBoardScene(reconcileScene(wrong, BOND));
  assert.match(svg, /data-layout="bond"/);
  assert.match(svg, /data-role="atom"/);
  assert.match(svg, /data-role="electron"/);
  assert.match(svg, /chemical bonds/);
  assert.match(svg, /forces that hold atoms together/);
  assert.doesNotMatch(svg, /data-role="membrane"/);
  assert.doesNotMatch(svg, /data-role="rotor"/);
});

test("chemiosmosis draws a membrane, complexes, and protons", () => {
  const svg = renderBoardScene(reconcileScene(null, MEMBRANE));
  assert.match(svg, /data-layout="membrane"/);
  assert.match(svg, /data-role="membrane"/);
  assert.match(svg, /data-role="complex"/);
  assert.match(svg, /data-role="rotor"/);
  assert.match(svg, /ATP synthase/);
  assert.match(svg, /protons/);
  assert.match(svg, />\+</);
  assert.doesNotMatch(svg, /data-role="atom"/);
});

test("a tax draws supply and demand, not a membrane", () => {
  const svg = renderBoardScene(reconcileScene(null, TAX));
  assert.match(svg, /data-layout="graph"/);
  assert.match(svg, /data-role="curve"/);
  assert.match(svg, /Demand/);
  assert.match(svg, /Supply/);
  assert.match(svg, /Tax/);
  assert.doesNotMatch(svg, /data-role="membrane"/);
  assert.doesNotMatch(svg, /data-role="atom"/);
});

test("the stamp act draws a stamp and a boycott, not a membrane", () => {
  const svg = renderBoardScene(reconcileScene(null, STAMP));
  assert.match(svg, /data-layout="stage"/);
  assert.match(svg, /data-role="page"/);
  assert.match(svg, /data-role="stamp"/);
  assert.match(svg, /Stamp Act/);
  assert.match(svg, /Boycott/);
  assert.match(svg, /1765/);
  assert.doesNotMatch(svg, /data-role="membrane"/);
});

test("an electron leaving one atom is a transfer, not a membrane", () => {
  const svg = renderBoardScene(
    reconcileScene(null, {
      title: "Ionic bond",
      brief: "Sodium transfers an electron to chlorine, so the atoms become charged.",
      labels: ["Sodium", "Chlorine"],
    })
  );
  assert.match(svg, /data-layout="bond"/);
  assert.match(svg, /class="hop"/);
  assert.match(svg, /Sodium/);
  assert.match(svg, /Chlorine/);
  assert.doesNotMatch(svg, /data-role="membrane"/);
});

test("invented labels are dropped and a missing required label is kept", () => {
  const scene = constrainScene(
    {
      motion: "cycle",
      glyphs: [
        { role: "station", label: "Lake" },
        { role: "station", label: "Evaporation" },
        { role: "station", label: "Cloud" },
      ],
      steps: [],
    },
    ["Evaporation", "Condensation", "Precipitation"]
  );
  const labels = scene.glyphs.map((glyph) => glyph.label);
  assert.deepEqual(labels, ["Evaporation", "Condensation", "Precipitation"]);
});

test("a bad model reply falls back to the labels", () => {
  assert.equal(parseSceneSpec({ layout: "poster" }), null);
  const scene = fallbackScene({ labels: ["2x + 3 = 11", "2x = 8", "x = 4"] });
  assert.equal(scene.motion, "steps");
  assert.deepEqual(scene.steps, ["2x + 3 = 11", "2x = 8", "x = 4"]);
});
