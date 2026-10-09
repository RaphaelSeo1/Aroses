import assert from "node:assert/strict";
import test from "node:test";
import type { BoardScene } from "@/types/mentored";
import { boardSceneSvg, parseBoardScene } from "./board-scene.ts";

const SUPPLY_DEMAND: BoardScene = {
  kicker: "Whiteboard",
  title: "A tax shifts supply left",
  marks: [
    { kind: "band", x: 50, y: 78, w: 70, h: 2, tone: "muted" },
    { kind: "band", x: 18, y: 46, w: 2, h: 64, tone: "muted" },
    { kind: "wave", x: 28, y: 30, w: 40, tone: "blue" },
    { kind: "text", x: 62, y: 26, text: "Demand", tone: "blue" },
    { kind: "wave", x: 36, y: 48, w: 36, tone: "rose" },
    { kind: "text", x: 70, y: 44, text: "Supply", tone: "rose" },
    { kind: "arrow", x: 48, y: 50, x2: 36, y2: 50, tone: "gold" },
    { kind: "text", x: 40, y: 62, text: "Tax", tone: "gold" },
  ],
};

const ALGEBRA_STEP: BoardScene = {
  kicker: "Whiteboard",
  title: "Isolate x",
  marks: [
    { kind: "box", x: 22, y: 40, w: 22, h: 14, text: "2x + 3", tone: "ink" },
    { kind: "text", x: 40, y: 41, text: "=", tone: "muted" },
    { kind: "box", x: 54, y: 40, w: 14, h: 14, text: "11", tone: "ink" },
    { kind: "arrow", x: 22, y: 52, x2: 22, y2: 64, tone: "rose" },
    { kind: "text", x: 36, y: 60, text: "subtract 3", tone: "rose" },
    { kind: "box", x: 22, y: 76, w: 16, h: 12, text: "2x", tone: "gold" },
    { kind: "text", x: 38, y: 77, text: "=", tone: "muted" },
    { kind: "box", x: 50, y: 76, w: 12, h: 12, text: "8", tone: "gold" },
  ],
};

const CAUSE_EFFECT: BoardScene = {
  kicker: "Whiteboard",
  title: "The stamp act leads to protest",
  marks: [
    { kind: "box", x: 24, y: 46, w: 28, h: 16, text: "Stamp Act", tone: "rose" },
    { kind: "arrow", x: 40, y: 46, x2: 58, y2: 46, tone: "gold" },
    { kind: "box", x: 74, y: 46, w: 24, h: 16, text: "Boycott", tone: "blue" },
    { kind: "text", x: 50, y: 28, text: "1765", tone: "muted" },
    { kind: "text", x: 50, y: 68, text: "Colonists refuse taxed paper", tone: "ink" },
    { kind: "dots", x: 74, y: 70, w: 16, h: 8, tone: "blue" },
  ],
};

function rendered(scene: BoardScene): string {
  const parsed = parseBoardScene(scene);
  assert.ok(parsed);
  return boardSceneSvg(parsed);
}

test("unrelated subjects each draw their own labels", () => {
  const economy = rendered(SUPPLY_DEMAND);
  const algebra = rendered(ALGEBRA_STEP);
  const history = rendered(CAUSE_EFFECT);

  assert.match(economy, /A tax shifts supply left/);
  assert.match(economy, /Demand/);
  assert.match(economy, /Supply/);
  assert.match(economy, /Tax/);

  assert.match(algebra, /Isolate x/);
  assert.match(algebra, /2x \+ 3/);
  assert.match(algebra, /subtract 3/);
  assert.match(algebra, />8</);

  assert.match(history, /The stamp act leads to protest/);
  assert.match(history, /Stamp Act/);
  assert.match(history, /Boycott/);
  assert.match(history, /1765/);

  assert.notEqual(economy, algebra);
  assert.notEqual(algebra, history);
  assert.notEqual(history, economy);
  assert.doesNotMatch(economy, /Stamp Act/);
  assert.doesNotMatch(algebra, /Demand/);
  assert.doesNotMatch(history, /Isolate x/);
});

test("parseBoardScene keeps drawable marks and drops junk", () => {
  const scene = parseBoardScene({
    kicker: "Whiteboard",
    title: "Gradient",
    marks: [
      { kind: "box", x: 20, y: 40, w: 10, h: 16, text: "Step", tone: "rose" },
      { kind: "nope", x: 1, y: 1 },
      { kind: "text", x: 50, y: 10, text: "Start" },
    ],
  });
  assert.ok(scene);
  assert.equal(scene.marks.length, 2);
  const svg = boardSceneSvg(scene);
  assert.match(svg, />Step</);
  assert.match(svg, />Start</);
});
