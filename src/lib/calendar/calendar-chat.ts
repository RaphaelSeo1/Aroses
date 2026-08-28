import type { CalendarItem } from "@/types/calendar";
import { formatTime, itemDateKey, localDateKey } from "@/lib/calendar/dates";

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

export function formatCalendarContext(items: CalendarItem[], now: Date): string {
  const today = localDateKey(now);
  if (items.length === 0) {
    return "CALENDAR: (empty)";
  }
  const lines = items.slice(0, 80).map((item) => {
    const date = itemDateKey(item.startsAt);
    const when = !item.startsAt
      ? "unscheduled"
      : item.allDay || item.kind === "todo"
        ? date ?? "unscheduled"
        : `${date ?? ""} ${formatTime(item.startsAt)}`.trim();
    const flags = [
      item.kind,
      item.important ? "important" : null,
      item.completedAt ? "done" : null,
      date && date < today && !item.completedAt ? "overdue" : null,
    ]
      .filter(Boolean)
      .join(", ");
    return `[${item.id}] ${item.title} — ${when} (${flags})`;
  });
  return `CALENDAR ITEMS (${items.length}):\n${lines.join("\n")}`;
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
