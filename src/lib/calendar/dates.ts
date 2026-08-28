const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Local calendar date as YYYY-MM-DD. */
export function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function parseLocalDateKey(key: string): Date {
  const [y, m, d] = key.split("-").map((p) => Number(p));
  return new Date(y || 0, (m || 1) - 1, d || 1);
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, n: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + n);
  return next;
}

export function weekdayShort(d: Date): string {
  return WEEKDAY_SHORT[d.getDay()] ?? "";
}

export function monthTitle(d: Date): string {
  return `${MONTH_LONG[d.getMonth()] ?? ""} ${d.getFullYear()}`;
}

/** 6×7 cells for a month view starting Sunday. */
export function monthCells(year: number, monthIndex: number): Date[] {
  const first = new Date(year, monthIndex, 1);
  const start = addDays(first, -first.getDay());
  const cells: Date[] = [];
  for (let i = 0; i < 42; i++) cells.push(addDays(start, i));
  return cells;
}

export function sameDay(a: Date, b: Date): boolean {
  return localDateKey(a) === localDateKey(b);
}

export function isoFromLocalDateKey(key: string, hours = 9, minutes = 0): string {
  const d = parseLocalDateKey(key);
  d.setHours(hours, minutes, 0, 0);
  return d.toISOString();
}

export function toDateInputValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return localDateKey(d);
}

export function toTimeInputValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function combineLocalDateTime(dateKey: string, time: string): string {
  const [h, m] = time.split(":").map((p) => Number(p));
  const d = parseLocalDateKey(dateKey);
  d.setHours(Number.isFinite(h) ? h : 9, Number.isFinite(m) ? m : 0, 0, 0);
  return d.toISOString();
}

/** Civil YYYY-MM-DD in an IANA zone (server-safe; do not use localDateKey on Vercel). */
export function dateKeyInZone(d: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(d);
    const get = (type: string) =>
      parts.find((p) => p.type === type)?.value ?? "00";
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch {
    return localDateKey(d);
  }
}

export function addCalendarDays(key: string, n: number): string {
  return localDateKey(addDays(parseLocalDateKey(key), n));
}

export function formatTime(iso: string, timeZone?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return d.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
      ...(timeZone ? { timeZone } : {}),
    });
  } catch {
    return d.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  }
}

export function formatDayHeading(d: Date): string {
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

export function formatShortDate(d: Date): string {
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function itemDateKey(
  startsAt: string | null,
  timeZone?: string
): string | null {
  if (!startsAt) return null;
  const d = new Date(startsAt);
  if (Number.isNaN(d.getTime())) return null;
  return timeZone ? dateKeyInZone(d, timeZone) : localDateKey(d);
}

export function startOfWeek(d: Date): Date {
  return addDays(startOfDay(d), -d.getDay());
}

export function weekDays(d: Date): Date[] {
  const start = startOfWeek(d);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function weekTitle(d: Date): string {
  const days = weekDays(d);
  const a = days[0]!;
  const b = days[6]!;
  const left = a.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const right = b.toLocaleDateString(undefined, {
    month: a.getMonth() === b.getMonth() ? undefined : "short",
    day: "numeric",
    year: a.getFullYear() === b.getFullYear() ? undefined : "numeric",
  });
  return `${left} – ${right}`;
}

export function itemTimestamp(startsAt: string | null): number {
  if (!startsAt) return Number.POSITIVE_INFINITY;
  const t = new Date(startsAt).getTime();
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

export function compareByStart(a: { startsAt: string | null }, b: { startsAt: string | null }): number {
  return itemTimestamp(a.startsAt) - itemTimestamp(b.startsAt);
}

export function formatItemWhen(
  startsAt: string | null,
  opts?: { allDay?: boolean; includeDate?: boolean }
): string {
  if (!startsAt) return "";
  const d = new Date(startsAt);
  if (Number.isNaN(d.getTime())) return "";
  const date = formatShortDate(d);
  if (opts?.allDay) return opts.includeDate === false ? "" : date;
  const time = formatTime(startsAt);
  if (opts?.includeDate === false) return time;
  return time ? `${date} · ${time}` : date;
}

/**
 * Convert a wall-clock time in `timeZone` to a UTC ISO string.
 * `dateKey` is YYYY-MM-DD; hours/minutes are 24h local in that zone.
 */
export function isoInTimeZone(
  dateKey: string,
  hours: number,
  minutes: number,
  timeZone: string
): string {
  const [y, m, d] = dateKey.split("-").map((p) => Number(p));
  const utcGuess = Date.UTC(y || 0, (m || 1) - 1, d || 1, hours, minutes, 0);
  const shift = (instant: number) => {
    const asZone = new Date(instant);
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone || "UTC",
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(asZone);
    const get = (type: string) =>
      Number(parts.find((p) => p.type === type)?.value ?? "0");
    let hour = get("hour");
    if (hour === 24) hour = 0;
    return (
      Date.UTC(get("year"), get("month") - 1, get("day"), hour, get("minute"), get("second")) -
      instant
    );
  };
  let utc = utcGuess;
  utc = utcGuess - shift(utc);
  utc = utcGuess - shift(utc);
  return new Date(utc).toISOString();
}

/** Human local clock in a named zone, for the Rose prompt. */
export function formatNowInZone(nowIso: string, timeZone: string): string {
  const d = new Date(nowIso);
  if (Number.isNaN(d.getTime())) return nowIso;
  try {
    return d.toLocaleString("en-US", {
      timeZone: timeZone || "UTC",
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZoneName: "short",
    });
  } catch {
    return d.toISOString();
  }
}

export function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

export function snapMinutes(mins: number, snap = 15): number {
  const clamped = Math.max(0, Math.min(24 * 60, mins));
  return Math.round(clamped / snap) * snap;
}

export function minutesToTimeValue(mins: number): string {
  const clamped = Math.max(0, Math.min(24 * 60 - 1, mins));
  return `${pad2(Math.floor(clamped / 60))}:${pad2(clamped % 60)}`;
}

export function addMinutesIso(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}

export function isoFromDateMinutes(day: Date, minutes: number): string {
  const d = startOfDay(day);
  d.setMinutes(Math.max(0, Math.min(24 * 60, minutes)));
  return d.toISOString();
}

export function upcomingDateKeys(
  from: Date,
  count: number,
  timeZone?: string
): { key: string; label: string }[] {
  const start = timeZone ? dateKeyInZone(from, timeZone) : localDateKey(from);
  const out: { key: string; label: string }[] = [];
  for (let i = 0; i < count; i++) {
    const key = addCalendarDays(start, i);
    const d = parseLocalDateKey(key);
    out.push({
      key,
      label: d.toLocaleDateString("en-US", {
        weekday: "long",
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
    });
  }
  return out;
}
