"use client";

import { useState } from "react";
import {
  addCalendarDays,
  combineLocalDateTime,
  isoFromLocalDateKey,
  localDateKey,
  toDateInputValue,
  toTimeInputValue,
} from "@/lib/calendar/dates";
import { useT } from "@/lib/i18n/LocaleProvider";
import type { CalendarItem, CalendarItemInput, CalendarKind } from "@/types/calendar";

export function CalendarItemForm({
  initial,
  defaultDateKey,
  defaultTime,
  defaultEndTime,
  defaultKind,
  defaultAllDay,
  defaultHasDate,
  onSave,
  onCancel,
}: {
  initial?: CalendarItem | null;
  defaultDateKey?: string;
  defaultTime?: string;
  defaultEndTime?: string;
  defaultKind?: CalendarKind;
  defaultAllDay?: boolean;
  defaultHasDate?: boolean;
  onSave: (input: CalendarItemInput) => Promise<void>;
  onCancel: () => void;
}) {
  const t = useT();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [kind, setKind] = useState<CalendarKind>(
    initial?.kind ?? defaultKind ?? "todo"
  );
  const [dateKey, setDateKey] = useState(
    toDateInputValue(initial?.startsAt) || defaultDateKey || localDateKey(new Date())
  );
  const [hasDate, setHasDate] = useState(
    initial
      ? Boolean(initial.startsAt)
      : defaultHasDate ?? Boolean(defaultDateKey)
  );
  const [allDay, setAllDay] = useState(
    initial ? initial.allDay !== false : defaultAllDay !== false
  );
  const [time, setTime] = useState(
    toTimeInputValue(initial?.startsAt) || defaultTime || "09:00"
  );
  const [endTime, setEndTime] = useState(
    toTimeInputValue(initial?.endsAt) || defaultEndTime || "10:00"
  );
  const [important, setImportant] = useState(Boolean(initial?.important));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      let startsAt: string | null = null;
      let endsAt: string | null = null;
      if (hasDate && dateKey) {
        const timed = !allDay;
        if (timed) {
          startsAt = combineLocalDateTime(dateKey, time);
          endsAt = combineLocalDateTime(dateKey, endTime);
          if (new Date(endsAt) <= new Date(startsAt)) {
            endsAt = combineLocalDateTime(addCalendarDays(dateKey, 1), endTime);
          }
        } else {
          startsAt = isoFromLocalDateKey(dateKey);
        }
      }
      await onSave({
        title: trimmed,
        notes: notes.trim(),
        kind,
        startsAt,
        endsAt,
        allDay: !hasDate || allDay,
        important,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : t.calendar.saveError);
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
      <div className="flex gap-1 rounded-full bg-zinc-100 p-0.5 text-[12px] font-semibold dark:bg-zinc-800">
        <button
          type="button"
          onClick={() => setKind("todo")}
          className={`flex-1 rounded-full px-3 py-1.5 ${
            kind === "todo"
              ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-50"
              : "text-zinc-500"
          }`}
        >
          {t.calendar.kindTodo}
        </button>
        <button
          type="button"
          onClick={() => setKind("event")}
          className={`flex-1 rounded-full px-3 py-1.5 ${
            kind === "event"
              ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-50"
              : "text-zinc-500"
          }`}
        >
          {t.calendar.kindEvent}
        </button>
      </div>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value.slice(0, 200))}
        placeholder={t.calendar.titleLabel}
        className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
        autoFocus
      />
      <label className="flex items-center gap-2 text-[12px] text-zinc-600 dark:text-zinc-300">
        <input
          type="checkbox"
          checked={hasDate}
          onChange={(e) => setHasDate(e.target.checked)}
        />
        {t.calendar.dateLabel}
      </label>
      {hasDate ? (
        <div className="flex gap-2">
          <input
            type="date"
            value={dateKey}
            onChange={(e) => setDateKey(e.target.value)}
            className="flex-1 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          />
          {hasDate && !allDay ? (
            <>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-28 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              />
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-28 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              />
            </>
          ) : null}
        </div>
      ) : null}
      {hasDate ? (
        <label className="flex items-center gap-2 text-[12px] text-zinc-600 dark:text-zinc-300">
          <input
            type="checkbox"
            checked={allDay}
            onChange={(e) => setAllDay(e.target.checked)}
          />
          {t.calendar.allDay}
        </label>
      ) : null}
      <label className="flex items-center gap-2 text-[12px] text-zinc-600 dark:text-zinc-300">
        <input
          type="checkbox"
          checked={important}
          onChange={(e) => setImportant(e.target.checked)}
        />
        {t.calendar.important}
      </label>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value.slice(0, 2000))}
        placeholder={t.calendar.notesLabel}
        rows={2}
        className="w-full resize-none rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
      />
      {error ? (
        <p className="text-[12px] text-red-600 dark:text-red-400">{error}</p>
      ) : null}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full px-3 py-1.5 text-[12px] font-semibold text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          {t.calendar.cancel}
        </button>
        <button
          type="button"
          disabled={busy || !title.trim()}
          onClick={() => void submit()}
          className="rounded-full bg-brand px-4 py-1.5 text-[12px] font-semibold text-white hover:bg-brand-hover disabled:opacity-50"
        >
          {t.calendar.save}
        </button>
      </div>
    </div>
  );
}
