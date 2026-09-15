import assert from "node:assert/strict";
import test from "node:test";
import {
  sourcePageUnitsForFile,
  sumSourcePageUnits,
  textSourcePageUnits,
} from "./source-page-units.ts";

test("PDF uses actual page counts", () => {
  assert.equal(sourcePageUnitsForFile({ kind: "pdf", pageCount: 12 }), 12);
});

test("slides count 1:1 and images count as 1", () => {
  assert.equal(sourcePageUnitsForFile({ kind: "slides", slideCount: 18 }), 18);
  assert.equal(sourcePageUnitsForFile({ kind: "image" }), 1);
});

test("docx/text/transcript use ceil(words/500) with a minimum of 1", () => {
  assert.equal(textSourcePageUnits(1), 1);
  assert.equal(textSourcePageUnits(500), 1);
  assert.equal(textSourcePageUnits(501), 2);
  assert.equal(
    sourcePageUnitsForFile({ kind: "word", wordCount: 1200 }),
    3
  );
  assert.equal(
    sourcePageUnitsForFile({ kind: "audio", wordCount: 100 }),
    1
  );
});

test("empty material is 0 so it cannot inflate usage", () => {
  assert.equal(sourcePageUnitsForFile({ kind: "pdf", pageCount: 0 }), 0);
  assert.equal(textSourcePageUnits(0), 0);
});

test("sums mixed sources", () => {
  assert.equal(
    sumSourcePageUnits([
      { kind: "pdf", pageCount: 10 },
      { kind: "slides", slideCount: 5 },
      { kind: "image" },
    ]),
    16
  );
});
