"use client";

import { useMemo, useState } from "react";
import { confirmDialog } from "@/components/AppDialogs";
import { CalendarItemForm } from "@/components/calendar/CalendarItemForm";
import { CalendarItemRow } from "@/components/calendar/CalendarItemRow";
import { CalendarMonthGrid } from "@/components/calendar/CalendarMonthGrid";
import { CalendarRoseChat } from "@/components/calendar/CalendarRoseChat";
import { CalendarTimeGrid } from "@/components/calendar/CalendarTimeGrid";
import { CalendarTodoList } from "@/components/calendar/CalendarTodoList";
import { useCalendarItems } from "@/components/calendar/use-calendar-items";
import {
  addDays,
  compareByStart,
  isoFromDateMinutes,
  itemDateKey,
  itemTimestamp,
  localDateKey,
  minutesOfDay,
  parseLocalDateKey,
  startOfDay,
  toTimeInputValue,
  weekDays,
  weekTitle,
} from "@/lib/calendar/dates";
import { isTimedItem, itemDurationMinutes } from "@/lib/calendar/grid";
import { useT } from "@/lib/i18n/LocaleProvider";
import type { CalendarItem } from "@/types/calendar";

type CalendarView = "day" | "week" | "month";

type EventDraft = {
  dateKey: string;
  time: string;
  endTime: string;
  allDay: boolean;
};

export function CalendarPageClient({
  initialDay,
  openChat = false,
}: {
  initialDay?: string;
  openChat?: boolean;
}) {
  const t = useT();
  const { items, setItems, loading, error, add, patch, remove } =
    useCalendarItems();
  const [selected, setSelected] = useState(() =>
    initialDay && /^\d{4}-\d{2}-\d{2}$/.test(initialDay)
      ? parseLocalDateKey(initialDay)
      : new Date()
  );
  const [cursor, setCursor] = useState(
    () => new Date(selected.getFullYear(), selected.getMonth(), 1)
  );
  const [view, setView] = useState<CalendarView>(() =>
    initialDay ? "day" : "week"
  );
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CalendarItem | null>(null);
  const [draft, setDraft] = useState<EventDraft | null>(null);
  const selectedKey = localDateKey(selected);

  const selectDay = (d: Date, nextView?: CalendarView) => {
    setSelected(d);
    setCursor(new Date(d.getFullYear(), d.getMonth(), 1));
    if (nextView) setView(nextView);
  };

  const markedKeys = useMemo(() => {
    const set = new Set<string>();
    for (const item of items) {
      const key = itemDateKey(item.startsAt);
      if (key) set.add(key);
    }
    return set;
  }, [items]);

  const itemsByDay = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    for (const item of items) {
      const key = itemDateKey(item.startsAt);
      if (!key) continue;
      const list = map.get(key);
      if (list) list.push(item);
      else map.set(key, [item]);
    }
    for (const list of map.values()) {
      list.sort(compareByStart);
    }
    return map;
  }, [items]);

  const todos = useMemo(
    () =>
      items
        .filter((i) => i.kind === "todo")
        .sort((a, b) => {
          if (a.completedAt && !b.completedAt) return 1;
          if (!a.completedAt && b.completedAt) return -1;
          return compareByStart(a, b);
        }),
    [items]
  );

  const upcoming = useMemo(() => {
    const startToday = startOfDay(new Date()).getTime();
    return items
      .filter((i) => {
        if (i.completedAt || !i.startsAt || i.kind === "todo") return false;
        return itemTimestamp(i.startsAt) >= startToday;
      })
      .sort(compareByStart)
      .slice(0, 8);
  }, [items]);

  const toggle = (item: CalendarItem) => {
    void patch(item.id, {
      completedAt: item.completedAt ? null : new Date().toISOString(),
    });
  };

  const destroy = async (item: CalendarItem) => {
    const ok = await confirmDialog({
      title: t.calendar.delete,
      body: item.title,
      tone: "danger",
      confirmLabel: t.calendar.delete,
      cancelLabel: t.calendar.cancel,
    });
    if (ok) await remove(item.id);
  };

  const openItem = (item: CalendarItem) => {
    setDraft(null);
    setEditing(item);
    setFormOpen(true);
    if (item.startsAt) {
      const d = new Date(item.startsAt);
      if (!Number.isNaN(d.getTime())) selectDay(d);
    }
  };

  const openNew = (next?: EventDraft) => {
    setEditing(null);
    setDraft(next ?? null);
    setFormOpen(true);
  };

  const placeItem = (
    item: CalendarItem,
    next: { startsAt: string; endsAt: string | null; allDay: boolean }
  ) => {
    void patch(item.id, next);
  };

  const dropOnDay = (itemId: string, day: Date) => {
    const item = items.find((i) => i.id === itemId);
    if (!item) return;
    if (isTimedItem(item) && item.startsAt) {
      const mins = minutesOfDay(new Date(item.startsAt));
      const duration = itemDurationMinutes(item);
      placeItem(item, {
        startsAt: isoFromDateMinutes(day, mins),
        endsAt: isoFromDateMinutes(day, mins + duration),
        allDay: false,
      });
      return;
    }
    placeItem(item, {
      startsAt: isoFromDateMinutes(day, 9 * 60),
      endsAt: null,
      allDay: true,
    });
  };

  const views: { id: CalendarView; label: string }[] = [
    { id: "day", label: t.calendar.viewDay },
    { id: "week", label: t.calendar.viewWeek },
    { id: "month", label: t.calendar.viewMonth },
  ];

  const rangePrev =
    view === "week"
      ? () => selectDay(addDays(selected, -7))
      : view === "day"
        ? () => selectDay(addDays(selected, -1))
        : () =>
            setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1));
  const rangeNext =
    view === "week"
      ? () => selectDay(addDays(selected, 7))
      : view === "day"
        ? () => selectDay(addDays(selected, 1))
        : () =>
            setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1));
  const rangePrevLabel =
    view === "week"
      ? t.calendar.weekPrev
      : view === "day"
        ? t.calendar.dayPrev
        : t.calendar.monthPrev;
  const rangeNextLabel =
    view === "week"
      ? t.calendar.weekNext
      : view === "day"
        ? t.calendar.dayNext
        : t.calendar.monthNext;

  const gridDays = view === "day" ? [selected] : weekDays(selected);

  return (
    <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-[1fr_22rem] lg:items-start">
      <div className="min-w-0 space-y-5">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
              {t.calendar.nav}
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              {t.calendar.title}
            </h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              {t.calendar.subtitle}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-full border border-zinc-200 bg-white p-0.5 text-[12px] font-semibold dark:border-zinc-700 dark:bg-zinc-900">
              {views.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setView(v.id)}
                  className={`rounded-full px-3 py-1.5 ${
                    view === v.id
                      ? "bg-brand text-white"
                      : "text-zinc-600 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  }`}
                >
                  {v.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() =>
                openNew({
                  dateKey: selectedKey,
                  time: "09:00",
                  endTime: "10:00",
                  allDay: false,
                })
              }
              className="rounded-full bg-brand px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-brand-hover"
            >
              {t.calendar.addEvent}
            </button>
          </div>
        </header>

        <section className="overflow-hidden rounded-3xl border border-zinc-200/90 bg-white/95 p-5 shadow-lg shadow-zinc-900/[0.04] dark:border-zinc-800 dark:bg-zinc-950/80">
          {view === "month" ? (
            <CalendarMonthGrid
              cursor={cursor}
              selected={selected}
              markedKeys={markedKeys}
              itemsByDay={itemsByDay}
              onSelect={(d) => selectDay(d)}
              onPrev={rangePrev}
              onNext={rangeNext}
              onOpenItem={openItem}
              onDropItem={dropOnDay}
            />
          ) : (
            <>
              <div className="mb-3 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={rangePrev}
                  className="rounded-full px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  aria-label={rangePrevLabel}
                >
                  ‹
                </button>
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                  {view === "week" ? weekTitle(selected) : null}
                  {view === "day"
                    ? selected.toLocaleDateString(undefined, {
                        weekday: "long",
                        month: "short",
                        day: "numeric",
                      })
                    : null}
                </p>
                <button
                  type="button"
                  onClick={rangeNext}
                  className="rounded-full px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  aria-label={rangeNextLabel}
                >
                  ›
                </button>
              </div>
              <CalendarTimeGrid
                days={gridDays}
                items={items}
                selected={selected}
                onSelectDay={(d) => selectDay(d)}
                onOpenItem={openItem}
                onPlaceItem={placeItem}
                onCreateRange={(startsAt, endsAt) => {
                  const start = new Date(startsAt);
                  selectDay(start);
                  openNew({
                    dateKey: localDateKey(start),
                    time: toTimeInputValue(startsAt) || "09:00",
                    endTime: toTimeInputValue(endsAt) || "10:00",
                    allDay: false,
                  });
                }}
              />
            </>
          )}

          {formOpen ? (
            <div className="mt-4">
              <CalendarItemForm
                key={
                  editing?.id ??
                  (draft
                    ? `${draft.dateKey}-${draft.time}-${draft.endTime}`
                    : "new")
                }
                initial={editing}
                defaultDateKey={draft?.dateKey ?? selectedKey}
                defaultTime={draft?.time}
                defaultEndTime={draft?.endTime}
                defaultKind={editing ? undefined : "event"}
                defaultAllDay={draft ? draft.allDay : undefined}
                defaultHasDate
                onCancel={() => {
                  setFormOpen(false);
                  setEditing(null);
                  setDraft(null);
                }}
                onSave={async (input) => {
                  if (editing) {
                    await patch(editing.id, input);
                  } else {
                    await add(input);
                  }
                  setFormOpen(false);
                  setEditing(null);
                  setDraft(null);
                }}
              />
            </div>
          ) : null}
        </section>

        <CalendarTodoList
          items={todos}
          loading={loading}
          error={error ? t.calendar.loadError : null}
          onAdd={async (title) => {
            await add({
              title,
              kind: "todo",
              startsAt: null,
              allDay: true,
            });
          }}
          onToggle={toggle}
          onDelete={(item) => void destroy(item)}
          onOpen={openItem}
        />

        {upcoming.length > 0 ? (
          <section className="overflow-hidden rounded-3xl border border-zinc-200/90 bg-white/95 p-5 dark:border-zinc-800 dark:bg-zinc-950/80">
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              {t.calendar.upcoming}
            </p>
            <div className="mt-2 space-y-0.5">
              {upcoming.map((item) => (
                <CalendarItemRow
                  key={item.id}
                  item={item}
                  showDate
                  onToggle={() => toggle(item)}
                  onDelete={() => void destroy(item)}
                  onOpen={() => openItem(item)}
                />
              ))}
            </div>
          </section>
        ) : null}
      </div>

      <div className="flex min-h-[28rem] lg:sticky lg:top-[5.5rem] lg:h-[calc(100vh-7.5rem)]">
        <CalendarRoseChat
          autoFocus={openChat}
          onItems={(next) => setItems(next)}
        />
      </div>
    </div>
  );
}
