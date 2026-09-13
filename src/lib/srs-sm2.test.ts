import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SRS_DEFAULT_STATE,
  applyRating,
  formatIntervalShort,
  previewRatings,
} from "./srs-sm2.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

test("first-review ratings use 10m / 30m / 10h / 1d for dueAt and labels", () => {
  const now = new Date("2026-09-13T12:00:00.000Z");
  const previews = previewRatings(SRS_DEFAULT_STATE, now);

  assert.equal(previews.again.label, "10m");
  assert.equal(previews.hard.label, "30m");
  assert.equal(previews.good.label, "10h");
  assert.equal(previews.easy.label, "1d");

  const again = applyRating(SRS_DEFAULT_STATE, "again", now);
  const hard = applyRating(SRS_DEFAULT_STATE, "hard", now);
  const good = applyRating(SRS_DEFAULT_STATE, "good", now);
  const easy = applyRating(SRS_DEFAULT_STATE, "easy", now);

  assert.equal(again.intervalMs, 10 * MINUTE);
  assert.equal(hard.intervalMs, 30 * MINUTE);
  assert.equal(good.intervalMs, 10 * HOUR);
  assert.equal(easy.intervalMs, DAY);

  assert.equal(again.dueAt.getTime(), now.getTime() + 10 * MINUTE);
  assert.equal(hard.dueAt.getTime(), now.getTime() + 30 * MINUTE);
  assert.equal(good.dueAt.getTime(), now.getTime() + 10 * HOUR);
  assert.equal(easy.dueAt.getTime(), now.getTime() + DAY);

  assert.equal(again.next.intervalDays, again.intervalMs / DAY);
  assert.equal(hard.next.intervalDays, hard.intervalMs / DAY);
  assert.equal(good.next.intervalDays, good.intervalMs / DAY);
  assert.equal(easy.next.intervalDays, easy.intervalMs / DAY);
});

test("later successful reviews still grow with SM-2", () => {
  const now = new Date("2026-09-13T12:00:00.000Z");
  const afterGood = applyRating(SRS_DEFAULT_STATE, "good", now).next;
  const secondGood = applyRating(afterGood, "good", now);
  assert.equal(secondGood.intervalMs, 6 * DAY);

  const afterEasy = applyRating(SRS_DEFAULT_STATE, "easy", now).next;
  const secondEasy = applyRating(afterEasy, "easy", now);
  assert.ok(secondEasy.intervalMs > DAY);
});

test("formatIntervalShort matches compact button copy", () => {
  assert.equal(formatIntervalShort(10 * MINUTE), "10m");
  assert.equal(formatIntervalShort(30 * MINUTE), "30m");
  assert.equal(formatIntervalShort(10 * HOUR), "10h");
  assert.equal(formatIntervalShort(DAY), "1d");
});
