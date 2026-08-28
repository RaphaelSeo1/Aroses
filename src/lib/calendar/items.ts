import type {
  CalendarItem,
  CalendarItemInput,
  CalendarKind,
} from "@/types/calendar";

export const CALENDAR_TITLE_MAX = 200;
export const CALENDAR_NOTES_MAX = 2000;

type Row = {
  id: string;
  title: string;
  notes: string | null;
  kind: string;
  starts_at: string | null;
  ends_at: string | null;
  all_day: boolean | null;
  important: boolean | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export function isCalendarKind(v: unknown): v is CalendarKind {
  return v === "todo" || v === "event";
}

export function mapCalendarRow(row: Row): CalendarItem {
  return {
    id: row.id,
    title: row.title,
    notes: row.notes ?? "",
    kind: isCalendarKind(row.kind) ? row.kind : "todo",
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    allDay: row.all_day !== false,
    important: Boolean(row.important),
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const CALENDAR_SELECT =
  "id, title, notes, kind, starts_at, ends_at, all_day, important, completed_at, created_at, updated_at";

function clampText(raw: unknown, max: number): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/\s+/g, " ").trim().slice(0, max);
}

function isoOrNull(raw: unknown): string | null {
  if (raw == null || raw === "") return null;
  if (typeof raw !== "string") return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function parseCalendarInput(body: unknown): CalendarItemInput | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const title = clampText(b.title, CALENDAR_TITLE_MAX);
  if (!title) return null;
  const kind = isCalendarKind(b.kind) ? b.kind : "todo";
  const notes = clampText(b.notes, CALENDAR_NOTES_MAX);
  const startsAt = isoOrNull(b.startsAt);
  let endsAt = isoOrNull(b.endsAt);
  if (startsAt && endsAt && new Date(endsAt) < new Date(startsAt)) {
    endsAt = null;
  }
  const allDay = typeof b.allDay === "boolean" ? b.allDay : true;
  const important = Boolean(b.important);
  let completedAt: string | null | undefined;
  if (b.completedAt === null) completedAt = null;
  else if (b.completedAt !== undefined) completedAt = isoOrNull(b.completedAt);

  return {
    title,
    notes,
    kind,
    startsAt,
    endsAt,
    allDay,
    important,
    ...(completedAt !== undefined ? { completedAt } : {}),
  };
}

export function parseCalendarPatch(body: unknown): Partial<CalendarItemInput> | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const out: Partial<CalendarItemInput> = {};
  if (typeof b.title === "string") {
    const title = clampText(b.title, CALENDAR_TITLE_MAX);
    if (!title) return null;
    out.title = title;
  }
  if (typeof b.notes === "string") out.notes = clampText(b.notes, CALENDAR_NOTES_MAX);
  if (isCalendarKind(b.kind)) out.kind = b.kind;
  if ("startsAt" in b) out.startsAt = isoOrNull(b.startsAt);
  if ("endsAt" in b) out.endsAt = isoOrNull(b.endsAt);
  if (typeof b.allDay === "boolean") out.allDay = b.allDay;
  if (typeof b.important === "boolean") out.important = b.important;
  if ("completedAt" in b) {
    out.completedAt = b.completedAt === null ? null : isoOrNull(b.completedAt);
  }
  return out;
}

export function toInsertRow(userId: string, input: CalendarItemInput) {
  return {
    user_id: userId,
    title: input.title,
    notes: input.notes ?? "",
    kind: input.kind ?? "todo",
    starts_at: input.startsAt ?? null,
    ends_at: input.endsAt ?? null,
    all_day: input.allDay !== false,
    important: Boolean(input.important),
    completed_at: input.completedAt ?? null,
  };
}

export function toPatchRow(patch: Partial<CalendarItemInput>) {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.title !== undefined) row.title = patch.title;
  if (patch.notes !== undefined) row.notes = patch.notes;
  if (patch.kind !== undefined) row.kind = patch.kind;
  if (patch.startsAt !== undefined) row.starts_at = patch.startsAt;
  if (patch.endsAt !== undefined) row.ends_at = patch.endsAt;
  if (patch.allDay !== undefined) row.all_day = patch.allDay;
  if (patch.important !== undefined) row.important = patch.important;
  if (patch.completedAt !== undefined) row.completed_at = patch.completedAt;
  return row;
}
