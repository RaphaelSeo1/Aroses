import assert from "node:assert/strict";
import test from "node:test";
import { listingBlocksFreeExplore } from "./listing-status.ts";

test("a delisted draft does not block free Explore", () => {
  assert.equal(listingBlocksFreeExplore("draft"), false);
  assert.equal(listingBlocksFreeExplore("rejected"), false);
  assert.equal(listingBlocksFreeExplore(null), false);
});

test("a live or in-review listing blocks free Explore", () => {
  assert.equal(listingBlocksFreeExplore("approved"), true);
  assert.equal(listingBlocksFreeExplore("pending_review"), true);
});
