import assert from "node:assert/strict";
import test from "node:test";
import { deckPageFromExtract, sanitizeDeckPages } from "./slide-pages";

test("deckPageFromExtract keeps divider and empty slides instead of dropping them", () => {
  const short = deckPageFromExtract(3, "Q&A");
  assert.equal(short.pageNum, 3);
  assert.match(short.extractedText, /Q&A/);

  const empty = deckPageFromExtract(12, "   ");
  assert.equal(empty.pageNum, 12);
  assert.match(empty.extractedText, /Slide 12/);
  assert.match(empty.extractedText, /visual/);
});

test("sanitizeDeckPages accepts client-extracted slides and drops junk", () => {
  const pages = sanitizeDeckPages([
    { pageNum: 2, title: "B", extractedText: "Second" },
    { pageNum: 1, title: "A", extractedText: "First" },
    { pageNum: 1, title: "dup", extractedText: "ignored" },
    { pageNum: 0, extractedText: "bad" },
    { extractedText: "no page" },
  ]);
  assert.ok(pages);
  assert.deepEqual(
    pages.map((p) => [p.pageNum, p.extractedText]),
    [
      [1, "First"],
      [2, "Second"],
    ]
  );
});

test("sanitizeDeckPages rejects empty payloads so the server can extract", () => {
  assert.equal(sanitizeDeckPages(null), null);
  assert.equal(sanitizeDeckPages([]), null);
  assert.equal(sanitizeDeckPages("nope"), null);
});

