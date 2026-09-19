import assert from "node:assert/strict";
import test from "node:test";
import { isDeckSeedComplete, takeDeckSeedBatch } from "./slide-pages";

test("isDeckSeedComplete: unfinished seed may resume; finished seed must not", () => {
  assert.equal(isDeckSeedComplete(0, 40), false);
  assert.equal(isDeckSeedComplete(12, 40), false);
  assert.equal(isDeckSeedComplete(40, 40), true);
  assert.equal(isDeckSeedComplete(47, 47), true);
  assert.equal(isDeckSeedComplete(50, 47), true);
  assert.equal(isDeckSeedComplete(5, 0), false);
});

test("takeDeckSeedBatch: after the last extractable page there is nothing left", () => {
  const pages = [
    { pageNum: 1, title: "A", extractedText: "one" },
    { pageNum: 2, title: "B", extractedText: "two" },
  ];
  const last = takeDeckSeedBatch(pages, 0, 6, 7_000);
  assert.equal(last.throughPage, 2);
  assert.equal(last.remaining, 0);
  const done = takeDeckSeedBatch(pages, last.throughPage, 6, 7_000);
  assert.equal(done.pages.length, 0);
  assert.equal(done.remaining, 0);
});
