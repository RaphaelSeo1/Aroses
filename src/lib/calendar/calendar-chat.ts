import type { CalendarItem, CalendarTodoSection } from "@/types/calendar";
import {
  compareByStart,
  dateKeyInZone,
  formatNowInZone,
  formatTime,
  isoInTimeZone,
  itemDateKey,
  parseLocalDateKey,
  upcomingDateKeys,
  weekdayShort,
} from "@/lib/calendar/dates";

function stripFence(s: string): string {
  return s
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

export type CalendarChatAction =
  | {
      type: "create";
      title: string;
      kind?: "todo" | "event";
      startsAt?: string | null;
      endsAt?: string | null;
      allDay?: boolean;
      important?: boolean;
      notes?: string;
    }
  | {
      type: "update";
      id: string;
      title?: string;
      kind?: "todo" | "event";
      startsAt?: string | null;
      endsAt?: string | null;
      allDay?: boolean;
      important?: boolean;
      notes?: string;
    }
  | { type: "complete"; id: string }
  | { type: "uncomplete"; id: string }
  | { type: "delete"; id: string };

export function formatCalendarContext(
  items: CalendarItem[],
  now: Date,
  timeZone?: string,
  sections: CalendarTodoSection[] = []
): string {
  const today = timeZone ? dateKeyInZone(now, timeZone) : itemDateKey(now.toISOString()) ?? "";
  const sectionTitle = new Map(sections.map((s) => [s.id, s.title]));
  const lists =
    sections.length > 0
      ? `TODO LISTS: General, ${sections.map((s) => s.title).join(", ")}\n`
      : "";
  if (items.length === 0) {
    return `${lists}CALENDAR: (empty)`.trim();
  }
  const sorted = [...items].sort((a, b) => {
    if (a.completedAt && !b.completedAt) return 1;
    if (!a.completedAt && b.completedAt) return -1;
    return compareByStart(a, b);
  });
  const lines = sorted.slice(0, 80).map((item) => {
    const date = itemDateKey(item.startsAt, timeZone);
    const wd = date ? weekdayShort(parseLocalDateKey(date)) : "";
    const when = !item.startsAt
      ? "unscheduled"
      : item.allDay
        ? `${date ?? "unscheduled"} ${wd} all-day`
        : `${date ?? ""} ${wd} ${formatTime(item.startsAt, timeZone)}`.trim();
    const listName = item.sectionId
      ? sectionTitle.get(item.sectionId) ?? null
      : null;
    const flags = [
      item.kind,
      listName ? `list:${listName}` : null,
      item.important ? "important" : null,
      item.completedAt ? "done" : null,
      date && date === today ? "today" : null,
      date && date < today && !item.completedAt ? "overdue" : null,
    ]
      .filter(Boolean)
      .join(", ");
    return `[${item.id}] ${item.title} — ${when} (${flags})`;
  });
  return `${lists}CALENDAR ITEMS earliest-first (${items.length}):\n${lines.join("\n")}`;
}

export function dateCheatSheet(nowIso: string, timeZone: string): string {
  const now = new Date(nowIso);
  const from = Number.isNaN(now.getTime()) ? new Date() : now;
  const rows = upcomingDateKeys(from, 14, timeZone)
    .map((d, i) => {
      const tag =
        i === 0 ? "TODAY" : i === 1 ? "TOMORROW" : d.label.split(",")[0] ?? "";
      return `${d.key} = ${d.label}${i < 2 ? ` (${tag})` : ""}`;
    })
    .join("\n");
  return `LOCAL NOW: ${formatNowInZone(nowIso, timeZone)}\nDATE KEYS (copy these YYYY-MM-DD values):\n${rows}`;
}

export function coerceActionTimestamps(
  action: CalendarChatAction,
  timeZone: string
): CalendarChatAction {
  if (action.type !== "create" && action.type !== "update") return action;
  const next = { ...action };
  if (next.startsAt != null && next.startsAt !== "") {
    const raw = String(next.startsAt).trim();
    const timed = /^\d{4}-\d{2}-\d{2}[ T]\d{1,2}:\d{2}/.test(raw);
    const coerced = coerceStartsAt(raw, timeZone);
    if (coerced) next.startsAt = coerced;
    if (timed) next.allDay = false;
  }
  if (next.endsAt != null && next.endsAt !== "") {
    const coerced = coerceStartsAt(next.endsAt, timeZone);
    if (coerced) next.endsAt = coerced;
  }
  return next;
}

/** Turn a model date into UTC ISO, interpreting naive dates in `timeZone`. */
export function coerceStartsAt(
  raw: string | null | undefined,
  timeZone: string
): string | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  if (/[zZ]$/.test(trimmed) || /[+-]\d{2}:?\d{2}$/.test(trimmed)) {
    const d = new Date(trimmed);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  const day = trimmed.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (day?.[1]) return isoInTimeZone(day[1], 9, 0, timeZone);
  const local = trimmed.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})/);
  if (local?.[1]) {
    return isoInTimeZone(
      local[1],
      Number(local[2]),
      Number(local[3]),
      timeZone
    );
  }
  const d = new Date(trimmed);
  if (!Number.isNaN(d.getTime())) return d.toISOString();
  return null;
}

export function actionFromToolUse(
  name: string,
  input: unknown
): CalendarChatAction | null {
  if (!input || typeof input !== "object") return null;
  const a = input as Record<string, unknown>;
  if (name === "create_item") {
    const title = typeof a.title === "string" ? a.title.trim() : "";
    if (!title) return null;
    const date =
      typeof a.date === "string" ? a.date.trim() : "";
    const time =
      typeof a.time === "string" ? a.time.trim() : "";
    const startsAt = date
      ? time
        ? `${date}T${normalizeClock(time) ?? time}`
        : date
      : null;
    return {
      type: "create",
      title,
      kind: a.kind === "event" ? "event" : "todo",
      startsAt,
      endsAt: null,
      allDay: !time,
      important: Boolean(a.important),
      notes: typeof a.notes === "string" ? a.notes : "",
    };
  }
  const id =
    typeof a.item === "string"
      ? a.item.trim()
      : typeof a.id === "string"
        ? a.id.trim()
        : typeof a.title === "string"
          ? a.title.trim()
          : "";
  if (!id) return null;
  if (name === "complete_item") return { type: "complete", id };
  if (name === "uncomplete_item") return { type: "uncomplete", id };
  if (name === "delete_item") return { type: "delete", id };
  if (name === "update_item") {
    const date =
      typeof a.date === "string" ? a.date.trim() : "";
    const time =
      typeof a.time === "string" ? a.time.trim() : "";
    let startsAt: string | undefined;
    if (date) {
      startsAt = time ? `${date}T${normalizeClock(time) ?? time}` : date;
    }
    return {
      type: "update",
      id,
      title: typeof a.title === "string" ? a.title : undefined,
      kind: a.kind === "event" || a.kind === "todo" ? a.kind : undefined,
      startsAt,
      allDay: time ? false : date ? true : undefined,
      important: typeof a.important === "boolean" ? a.important : undefined,
      notes: typeof a.notes === "string" ? a.notes : undefined,
    };
  }
  return null;
}

function normalizeClock(raw: string): string | null {
  const trimmed = raw.trim();
  const m24 = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (m24) {
    const h = Number(m24[1]);
    const min = Number(m24[2]);
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) {
      return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
    }
  }
  const ampm = trimmed.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
  if (ampm) {
    let h = Number(ampm[1]);
    const min = Number(ampm[2] ?? "0");
    const mer = (ampm[3] ?? "").toLowerCase();
    if (h < 1 || h > 12 || min < 0 || min > 59) return null;
    if (mer === "am") h = h === 12 ? 0 : h;
    else h = h === 12 ? 12 : h + 12;
    return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
  }
  return null;
}

export function parseCalendarModelContent(
  content: { type: string; text?: string; name?: string; input?: unknown }[]
): { reply: string; actions: CalendarChatAction[] } {
  const texts: string[] = [];
  const actions: CalendarChatAction[] = [];
  for (const block of content) {
    if (block.type === "text" && typeof block.text === "string") {
      texts.push(block.text);
    } else if (block.type === "tool_use" && typeof block.name === "string") {
      const action = actionFromToolUse(block.name, block.input);
      if (action) actions.push(action);
    }
  }
  const fromTools = actions.slice(0, 8);
  if (fromTools.length > 0) {
    return { reply: texts.join("\n").trim(), actions: fromTools };
  }
  return parseCalendarChatResponse(texts.join("\n"));
}

export function parseCalendarChatResponse(raw: string): {
  reply: string;
  actions: CalendarChatAction[];
} {
  const trimmed = stripFence(raw.trim());
  if (!trimmed) return { reply: "", actions: [] };

  const tryObj = (text: string): { reply?: unknown; actions?: unknown } | null => {
    try {
      const parsed = JSON.parse(text) as {
        reply?: unknown;
        actions?: unknown;
      };
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      /* ignore */
    }
    return null;
  };

  let parsed = tryObj(trimmed);
  if (!parsed) {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) parsed = tryObj(trimmed.slice(start, end + 1));
  }

  const reply =
    parsed && typeof parsed.reply === "string" ? parsed.reply.trim() : trimmed;
  const actions = Array.isArray(parsed?.actions)
    ? parsed.actions
        .map(normalizeAction)
        .filter((a): a is CalendarChatAction => a !== null)
        .slice(0, 8)
    : [];

  return { reply, actions };
}

function normalizeAction(raw: unknown): CalendarChatAction | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  const type = typeof a.type === "string" ? a.type : "";
  if (type === "create") {
    const title = typeof a.title === "string" ? a.title.trim() : "";
    if (!title) return null;
    return {
      type: "create",
      title,
      kind: a.kind === "event" ? "event" : "todo",
      startsAt: typeof a.startsAt === "string" ? a.startsAt : null,
      endsAt: typeof a.endsAt === "string" ? a.endsAt : null,
      allDay: a.allDay !== false,
      important: Boolean(a.important),
      notes: typeof a.notes === "string" ? a.notes : "",
    };
  }
  const id =
    typeof a.id === "string"
      ? a.id.trim()
      : typeof a.title === "string"
        ? a.title.trim()
        : "";
  if (!id) return null;
  if (type === "complete") return { type: "complete", id };
  if (type === "uncomplete") return { type: "uncomplete", id };
  if (type === "delete") return { type: "delete", id };
  if (type === "update") {
    return {
      type: "update",
      id,
      title: typeof a.title === "string" ? a.title : undefined,
      kind: a.kind === "event" || a.kind === "todo" ? a.kind : undefined,
      startsAt:
        a.startsAt === null
          ? null
          : typeof a.startsAt === "string"
            ? a.startsAt
            : undefined,
      endsAt:
        a.endsAt === null
          ? null
          : typeof a.endsAt === "string"
            ? a.endsAt
            : undefined,
      allDay: typeof a.allDay === "boolean" ? a.allDay : undefined,
      important: typeof a.important === "boolean" ? a.important : undefined,
      notes: typeof a.notes === "string" ? a.notes : undefined,
    };
  }
  return null;
}

export function resolveCalendarItemId(
  raw: string,
  items: CalendarItem[]
): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (items.some((i) => i.id === trimmed)) return trimmed;
  const q = trimmed.toLowerCase();
  const matches = items.filter((i) => i.title.toLowerCase() === q);
  if (matches.length === 1) return matches[0]!.id;
  const contains = items.filter(
    (i) =>
      i.title.toLowerCase().includes(q) || q.includes(i.title.toLowerCase())
  );
  if (contains.length === 1) return contains[0]!.id;
  return null;
}
