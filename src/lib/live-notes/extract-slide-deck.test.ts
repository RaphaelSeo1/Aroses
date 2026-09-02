import assert from "node:assert/strict";
import test from "node:test";
import { deckPageFromExtract } from "./extract-slide-deck";

test("deckPageFromExtract keeps divider and empty slides instead of dropping them", () => {
  const short = deckPageFromExtract(3, "Q&A");
  assert.equal(short.pageNum, 3);
  assert.match(short.extractedText, /Q&A/);

  const empty = deckPageFromExtract(12, "   ");
  assert.equal(empty.pageNum, 12);
  assert.match(empty.extractedText, /Slide 12/);
  assert.match(empty.extractedText, /visual/);
});
