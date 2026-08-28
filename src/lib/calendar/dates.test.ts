import assert from "node:assert/strict";
import test from "node:test";
import {
  combineLocalDateTime,
  dateKeyInZone,
  isoInTimeZone,
  itemDateKey,
  localDateKey,
  monthCells,
  parseLocalDateKey,
  sameDay,
  upcomingDateKeys,
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

test("dateKeyInZone uses the named zone not the machine clock", () => {
  const instant = new Date("2026-08-28T03:00:00.000Z");
  assert.equal(dateKeyInZone(instant, "UTC"), "2026-08-28");
  assert.equal(dateKeyInZone(instant, "America/Los_Angeles"), "2026-08-27");
});

test("isoInTimeZone maps wall clock in Pacific to UTC", () => {
  const iso = isoInTimeZone("2026-08-28", 15, 0, "America/Los_Angeles");
  assert.equal(iso, "2026-08-28T22:00:00.000Z");
});

test("upcomingDateKeys starts on the zone's civil date", () => {
  const keys = upcomingDateKeys(
    new Date("2026-08-28T03:00:00.000Z"),
    3,
    "America/Los_Angeles"
  );
  assert.equal(keys[0]?.key, "2026-08-27");
  assert.equal(keys[1]?.key, "2026-08-28");
  assert.equal(keys[2]?.key, "2026-08-29");
});
