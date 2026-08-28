"use client";

import { useMemo, useState } from "react";
import { confirmDialog } from "@/components/AppDialogs";
import { CalendarItemForm } from "@/components/calendar/CalendarItemForm";
import { CalendarItemRow } from "@/components/calendar/CalendarItemRow";
import { CalendarMonthGrid } from "@/components/calendar/CalendarMonthGrid";
import { CalendarRoseChat } from "@/components/calendar/CalendarRoseChat";
import { useCalendarItems } from "@/components/calendar/use-calendar-items";
import {
  addDays,
  compareByStart,
  formatDayHeading,
  itemDateKey,
  itemTimestamp,
  localDateKey,
  parseLocalDateKey,
  sameDay,
  startOfDay,
  weekDays,
  weekdayShort,
  weekTitle,
} from "@/lib/calendar/dates";
import { useT } from "@/lib/i18n/LocaleProvider";
import type { CalendarItem } from "@/types/calendar";

type CalendarView = "day" | "week" | "month";

function sortAgenda(items: CalendarItem[]): CalendarItem[] {
  return [...items].sort((a, b) => {
    if (a.important && !b.important) return -1;
    if (!a.important && b.important) return 1;
    if (a.completedAt && !b.completedAt) return 1;
    if (!a.completedAt && b.completedAt) return -1;
    return compareByStart(a, b);
  });
}

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
    initialDay ? "day" : "month"
  );
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CalendarItem | null>(null);
  const selectedKey = localDateKey(selected);
  const today = useMemo(() => new Date(), []);

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

  const dayItems = useMemo(
    () => sortAgenda(itemsByDay.get(selectedKey) ?? []),
    [itemsByDay, selectedKey]
  );

  const unscheduled = useMemo(
    () => items.filter((i) => !i.startsAt && !i.completedAt),
    [items]
  );

  const upcoming = useMemo(() => {
    const startToday = startOfDay(new Date()).getTime();
    return items
      .filter((i) => {
        if (i.completedAt || !i.startsAt) return false;
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
    setEditing(item);
    setFormOpen(true);
    if (item.startsAt) {
      const d = new Date(item.startsAt);
      if (!Number.isNaN(d.getTime())) selectDay(d);
    }
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
            setCursor(
              new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1)
            );
  const rangeNext =
    view === "week"
      ? () => selectDay(addDays(selected, 7))
      : view === "day"
        ? () => selectDay(addDays(selected, 1))
        : () =>
            setCursor(
              new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)
            );
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

  return (
    <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[1fr_22rem] lg:items-start">
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
        </header>

        {view === "month" ? (
          <section className="overflow-hidden rounded-3xl border border-zinc-200/90 bg-white/95 p-5 shadow-lg shadow-zinc-900/[0.04] dark:border-zinc-800 dark:bg-zinc-950/80">
            <CalendarMonthGrid
              cursor={cursor}
              selected={selected}
              markedKeys={markedKeys}
              onSelect={(d) => selectDay(d)}
              onPrev={rangePrev}
              onNext={rangeNext}
            />
          </section>
        ) : null}

        {view === "week" ? (
          <section className="overflow-hidden rounded-3xl border border-zinc-200/90 bg-white/95 p-5 shadow-lg shadow-zinc-900/[0.04] dark:border-zinc-800 dark:bg-zinc-950/80">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={rangePrev}
                className="rounded-full px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                aria-label={rangePrevLabel}
              >
                ‹
              </button>
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                {weekTitle(selected)}
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
            <div className="-mx-1 mt-3 overflow-x-auto pb-1">
              <div className="grid min-w-[48rem] grid-cols-7 gap-2">
                {weekDays(selected).map((d) => {
                  const key = localDateKey(d);
                  const list = itemsByDay.get(key) ?? [];
                  const isToday = sameDay(d, today);
                  const isSelected = sameDay(d, selected);
                  return (
                    <div
                      key={key}
                      className={`min-w-0 rounded-2xl border p-2 ${
                        isSelected
                          ? "border-brand/50 bg-brand-blush/40 dark:border-brand/40 dark:bg-brand-blush/10"
                          : "border-zinc-200/80 dark:border-zinc-800"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => selectDay(d, "day")}
                        className="w-full text-left"
                      >
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                          {weekdayShort(d)}
                        </p>
                        <p
                          className={`mt-0.5 text-sm font-semibold tabular-nums ${
                            isToday ? "text-brand" : "text-zinc-800 dark:text-zinc-100"
                          }`}
                        >
                          {d.getDate()}
                        </p>
                      </button>
                      <div className="mt-2 space-y-1">
                        {list.slice(0, 4).map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => openItem(item)}
                            className={`block w-full truncate rounded-lg px-1.5 py-1 text-left text-[11px] font-medium ${
                              item.completedAt
                                ? "text-zinc-400 line-through"
                                : item.important
                                  ? "bg-brand-blush/70 text-brand-ink dark:bg-brand-blush/15 dark:text-brand-soft"
                                  : "bg-zinc-50 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
                            }`}
                          >
                            {item.title}
                          </button>
                        ))}
                        {list.length > 4 ? (
                          <p className="text-[10px] text-zinc-400">
                            +{list.length - 4}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        ) : null}

        <section className="overflow-hidden rounded-3xl border border-zinc-200/90 bg-white/95 p-5 shadow-lg shadow-zinc-900/[0.04] dark:border-zinc-800 dark:bg-zinc-950/80">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              {view === "day" ? (
                <button
                  type="button"
                  onClick={rangePrev}
                  className="rounded-full px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  aria-label={rangePrevLabel}
                >
                  ‹
                </button>
              ) : null}
              <div className="min-w-0">
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                  {formatDayHeading(selected)}
                </p>
                {sameDay(selected, today) ? (
                  <p className="text-xs text-zinc-400">{t.calendar.today}</p>
                ) : null}
              </div>
              {view === "day" ? (
                <button
                  type="button"
                  onClick={rangeNext}
                  className="rounded-full px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  aria-label={rangeNextLabel}
                >
                  ›
                </button>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
              className="rounded-full bg-brand px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-brand-hover"
            >
              {t.calendar.addEvent}
            </button>
          </div>

          {formOpen ? (
            <div className="mt-4">
              <CalendarItemForm
                initial={editing}
                defaultDateKey={selectedKey}
                onCancel={() => {
                  setFormOpen(false);
                  setEditing(null);
                }}
                onSave={async (input) => {
                  if (editing) {
                    await patch(editing.id, input);
                  } else {
                    await add(input);
                  }
                  setFormOpen(false);
                  setEditing(null);
                }}
              />
            </div>
          ) : null}

          <div className="mt-3 space-y-0.5">
            {loading ? (
              <p className="py-4 text-sm text-zinc-400">{t.common.loading}</p>
            ) : error ? (
              <p className="py-4 text-sm text-red-600">{t.calendar.loadError}</p>
            ) : dayItems.length === 0 ? (
              <p className="py-4 text-sm text-zinc-400">{t.calendar.emptyDay}</p>
            ) : (
              dayItems.map((item) => (
                <CalendarItemRow
                  key={item.id}
                  item={item}
                  onToggle={() => toggle(item)}
                  onDelete={() => void destroy(item)}
                  onOpen={() => openItem(item)}
                />
              ))
            )}
          </div>
        </section>

        {unscheduled.length > 0 ? (
          <section className="overflow-hidden rounded-3xl border border-zinc-200/90 bg-white/95 p-5 dark:border-zinc-800 dark:bg-zinc-950/80">
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              {t.calendar.unscheduled}
            </p>
            <div className="mt-2 space-y-0.5">
              {unscheduled.map((item) => (
                <CalendarItemRow
                  key={item.id}
                  item={item}
                  onToggle={() => toggle(item)}
                  onDelete={() => void destroy(item)}
                  onOpen={() => openItem(item)}
                />
              ))}
            </div>
          </section>
        ) : null}

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
