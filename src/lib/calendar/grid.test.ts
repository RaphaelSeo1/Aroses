import assert from "node:assert/strict";
import test from "node:test";
import { layoutTimedItems } from "./grid";
import { localDateKey, snapMinutes } from "./dates";
import type { CalendarItem } from "@/types/calendar";

function localIso(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number
): string {
  return new Date(year, month - 1, day, hour, minute).toISOString();
}

function item(id: string, startsAt: string, endsAt: string | null): CalendarItem {
  return {
    id,
    title: id,
    notes: "",
    kind: "event",
    startsAt,
    endsAt,
    allDay: false,
    important: false,
    completedAt: null,
    sectionId: null,
    createdAt: "",
    updatedAt: "",
  };
}

test("snapMinutes rounds to 15", () => {
  assert.equal(snapMinutes(7), 0);
  assert.equal(snapMinutes(8), 15);
  assert.equal(snapMinutes(22), 15);
  assert.equal(snapMinutes(23), 30);
});

test("layoutTimedItems puts overlapping events in two columns", () => {
  const day = localDateKey(new Date(2026, 7, 28));
  const a = item("a", localIso(2026, 8, 28, 16, 0), localIso(2026, 8, 28, 17, 0));
  const b = item("b", localIso(2026, 8, 28, 16, 30), localIso(2026, 8, 28, 17, 30));
  const laid = layoutTimedItems([a, b], day);
  assert.equal(laid.length, 2);
  const cols = new Set(laid.map((x) => x.col));
  assert.equal(cols.size, 2);
  assert.ok(laid.every((x) => x.cols === 2));
});

test("layoutTimedItems keeps sequential events in one column", () => {
  const day = localDateKey(new Date(2026, 7, 28));
  const a = item("a", localIso(2026, 8, 28, 15, 0), localIso(2026, 8, 28, 16, 0));
  const b = item("b", localIso(2026, 8, 28, 16, 0), localIso(2026, 8, 28, 17, 0));
  const laid = layoutTimedItems([a, b], day);
  assert.equal(laid.length, 2);
  assert.ok(laid.every((x) => x.cols === 1 && x.col === 0));
});
