import assert from "node:assert/strict";
import test from "node:test";
import {
  combineLocalDateTime,
  itemDateKey,
  localDateKey,
  monthCells,
  parseLocalDateKey,
  sameDay,
} from "./dates";

test("localDateKey round-trips", () => {
  const d = parseLocalDateKey("2026-08-27");
  assert.equal(localDateKey(d), "2026-08-27");
  assert.equal(d.getDate(), 27);
  assert.equal(d.getMonth(), 7);
});

test("monthCells always returns 42 days starting Sunday", () => {
  const cells = monthCells(2026, 7);
  assert.equal(cells.length, 42);
  assert.equal(cells[0]!.getDay(), 0);
  assert.ok(cells.some((c) => sameDay(c, new Date(2026, 7, 1))));
  assert.ok(cells.some((c) => sameDay(c, new Date(2026, 7, 31))));
});

test("combineLocalDateTime uses local wall clock", () => {
  const iso = combineLocalDateTime("2026-08-27", "15:30");
  const d = new Date(iso);
  assert.equal(localDateKey(d), "2026-08-27");
  assert.equal(d.getHours(), 15);
  assert.equal(d.getMinutes(), 30);
});

test("itemDateKey is null without a start", () => {
  assert.equal(itemDateKey(null), null);
  assert.equal(itemDateKey("not-a-date"), null);
});
