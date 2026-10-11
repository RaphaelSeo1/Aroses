import assert from "node:assert/strict";
import test from "node:test";
import {
  constrainScene,
  fallbackScene,
  parseSceneSpec,
  renderBoardScene,
  stepOpacity,
} from "./board-scene-spec.ts";

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
    layout: "steps",
    motion: "steps",
    parts: [],
    steps: ["2x + 3 = 11", "2x = 8", "x = 4"],
  });
  assert.match(svg, /2x \+ 3 = 11/);
  assert.match(svg, /x = 4/);
  assert.match(svg, /step2\{animation:step2 [^}]*forwards\}/);
});

test("every label is placed inside the frame", () => {
  const scenes = [
    renderBoardScene({
      layout: "flow",
      motion: "flow",
      parts: [
        { label: "I", tone: "rose" },
        { label: "II", tone: "rose" },
        { label: "III", tone: "rose" },
        { label: "IV", tone: "rose" },
        { label: "ATP synthase", kind: "end", tone: "gold" },
      ],
      steps: [],
    }),
    renderBoardScene({
      layout: "stage",
      motion: "press",
      parts: [
        { label: "Stamp Act", kind: "card" },
        { label: "Boycott", kind: "aside" },
        { label: "1765", kind: "note" },
      ],
      steps: [],
    }),
    renderBoardScene({
      layout: "graph",
      motion: "slide",
      parts: [
        { label: "Demand", kind: "demand", tone: "blue" },
        { label: "Supply", kind: "supply", tone: "rose" },
        { label: "Tax", kind: "marker", tone: "gold" },
      ],
      steps: [],
    }),
    renderBoardScene({
      layout: "cycle",
      motion: "cycle",
      parts: [
        { label: "Evaporation", kind: "station", tone: "gold" },
        { label: "Condensation", kind: "station", tone: "white" },
        { label: "Precipitation", kind: "station", tone: "blue" },
      ],
      steps: [],
    }),
  ];
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

test("invented labels are dropped and a missing required label is kept", () => {
  const scene = constrainScene(
    {
      layout: "cycle",
      motion: "cycle",
      parts: [
        { label: "Lake", kind: "station" },
        { label: "Evaporation", kind: "station" },
        { label: "Cloud", kind: "station" },
      ],
      steps: [],
    },
    ["Evaporation", "Condensation", "Precipitation"]
  );
  const labels = scene.parts.map((part) => part.label);
  assert.deepEqual(labels, ["Evaporation", "Condensation", "Precipitation"]);
});

test("a bad model reply falls back to the labels", () => {
  assert.equal(parseSceneSpec({ layout: "poster" }), null);
  const scene = fallbackScene({ labels: ["2x + 3 = 11", "2x = 8", "x = 4"] });
  assert.equal(scene.layout, "steps");
  assert.deepEqual(scene.steps, ["2x + 3 = 11", "2x = 8", "x = 4"]);
});
