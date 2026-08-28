import type { CalendarItem } from "@/types/calendar";
import {
  itemDateKey,
  itemTimestamp,
  localDateKey,
  minutesOfDay,
} from "@/lib/calendar/dates";

export const CALENDAR_DND_TYPE = "application/x-aroses-calendar-item";
export const PX_PER_HOUR = 56;
export const SNAP_MINUTES = 15;
export const DEFAULT_DURATION_MIN = 60;
export const MIN_DURATION_MIN = 15;
export const GRID_HOURS = 24;

export function isTimedItem(item: CalendarItem): boolean {
  return Boolean(item.startsAt) && item.allDay === false;
}

export function isAllDayOn(item: CalendarItem, dateKey: string): boolean {
  if (!item.startsAt || item.completedAt) return false;
  if (itemDateKey(item.startsAt) !== dateKey) return false;
  return !isTimedItem(item);
}

export function itemDurationMinutes(item: CalendarItem): number {
  if (!item.startsAt) return DEFAULT_DURATION_MIN;
  const start = new Date(item.startsAt).getTime();
  if (Number.isNaN(start)) return DEFAULT_DURATION_MIN;
  if (item.endsAt) {
    const end = new Date(item.endsAt).getTime();
    if (!Number.isNaN(end) && end > start) {
      return Math.max(MIN_DURATION_MIN, Math.round((end - start) / 60_000));
    }
  }
  return DEFAULT_DURATION_MIN;
}

export function yToMinutes(y: number): number {
  return Math.round((y / PX_PER_HOUR) * 60);
}

export function minutesToY(mins: number): number {
  return (mins / 60) * PX_PER_HOUR;
}

export type TimedLayout = {
  item: CalendarItem;
  startMin: number;
  endMin: number;
  col: number;
  cols: number;
};

export function layoutTimedItems(
  items: CalendarItem[],
  dateKey: string
): TimedLayout[] {
  const ranges = items
    .filter((item) => isTimedItem(item) && itemDateKey(item.startsAt) === dateKey)
    .map((item) => {
      const start = minutesOfDay(new Date(item.startsAt!));
      let end = start + itemDurationMinutes(item);
      const endKey = item.endsAt ? itemDateKey(item.endsAt) : dateKey;
      if (endKey && endKey > dateKey) end = GRID_HOURS * 60;
      if (end <= start) end = start + MIN_DURATION_MIN;
      return {
        item,
        startMin: Math.max(0, start),
        endMin: Math.min(GRID_HOURS * 60, end),
      };
    })
    .sort(
      (a, b) =>
        a.startMin - b.startMin ||
        a.endMin - b.endMin ||
        itemTimestamp(a.item.startsAt) - itemTimestamp(b.item.startsAt)
    );

  const colEnd: number[] = [];
  const withCol = ranges.map((r) => {
    let col = 0;
    while (col < colEnd.length && colEnd[col]! > r.startMin) col += 1;
    if (col === colEnd.length) colEnd.push(r.endMin);
    else colEnd[col] = r.endMin;
    return { ...r, col, cols: 1 };
  });

  const parent = withCol.map((_, i) => i);
  const find = (i: number): number => {
    if (parent[i] !== i) parent[i] = find(parent[i]!);
    return parent[i]!;
  };
  const unite = (a: number, b: number) => {
    const pa = find(a);
    const pb = find(b);
    if (pa !== pb) parent[pa] = pb;
  };
  for (let i = 0; i < withCol.length; i++) {
    for (let j = i + 1; j < withCol.length; j++) {
      const a = withCol[i]!;
      const b = withCol[j]!;
      if (a.startMin < b.endMin && b.startMin < a.endMin) unite(i, j);
    }
  }
  const clusterMax = new Map<number, number>();
  withCol.forEach((r, i) => {
    const root = find(i);
    clusterMax.set(root, Math.max(clusterMax.get(root) ?? 0, r.col + 1));
  });
  return withCol.map((r, i) => ({
    ...r,
    cols: clusterMax.get(find(i)) ?? 1,
  }));
}
