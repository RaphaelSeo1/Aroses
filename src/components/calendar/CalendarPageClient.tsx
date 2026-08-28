"use client";

import { useMemo, useState } from "react";
import { confirmDialog } from "@/components/AppDialogs";
import { CalendarItemForm } from "@/components/calendar/CalendarItemForm";
import { CalendarItemRow } from "@/components/calendar/CalendarItemRow";
import { CalendarMonthGrid } from "@/components/calendar/CalendarMonthGrid";
import { CalendarRoseChat } from "@/components/calendar/CalendarRoseChat";
import { useCalendarItems } from "@/components/calendar/use-calendar-items";
import {
  formatDayHeading,
  itemDateKey,
  localDateKey,
  parseLocalDateKey,
} from "@/lib/calendar/dates";
import { useT } from "@/lib/i18n/LocaleProvider";
import type { CalendarItem } from "@/types/calendar";

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
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CalendarItem | null>(null);
  const selectedKey = localDateKey(selected);

  const markedKeys = useMemo(() => {
    const set = new Set<string>();
    for (const item of items) {
      const key = itemDateKey(item.startsAt);
      if (key) set.add(key);
    }
    return set;
  }, [items]);

  const dayItems = useMemo(
    () =>
      items
        .filter((i) => itemDateKey(i.startsAt) === selectedKey)
        .sort((a, b) => {
          if (a.important && !b.important) return -1;
          if (!a.important && b.important) return 1;
          if (a.completedAt && !b.completedAt) return 1;
          if (!a.completedAt && b.completedAt) return -1;
          return (a.startsAt ?? "").localeCompare(b.startsAt ?? "");
        }),
    [items, selectedKey]
  );

  const unscheduled = useMemo(
    () => items.filter((i) => !i.startsAt && !i.completedAt),
    [items]
  );

  const upcoming = useMemo(() => {
    const today = localDateKey(new Date());
    return items
      .filter((i) => {
        const key = itemDateKey(i.startsAt);
        return key && key > selectedKey && key >= today && !i.completedAt;
      })
      .sort((a, b) => (a.startsAt ?? "").localeCompare(b.startsAt ?? ""))
      .slice(0, 6);
  }, [items, selectedKey]);

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

  return (
    <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[1fr_22rem] lg:items-start">
      <div className="min-w-0 space-y-5">
        <header>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
            {t.calendar.nav}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {t.calendar.title}
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {t.calendar.subtitle}
          </p>
        </header>

        <section className="overflow-hidden rounded-3xl border border-zinc-200/90 bg-white/95 p-5 shadow-lg shadow-zinc-900/[0.04] dark:border-zinc-800 dark:bg-zinc-950/80">
          <CalendarMonthGrid
            cursor={cursor}
            selected={selected}
            markedKeys={markedKeys}
            onSelect={(d) => {
              setSelected(d);
              setCursor(new Date(d.getFullYear(), d.getMonth(), 1));
            }}
            onPrev={() =>
              setCursor(
                new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1)
              )
            }
            onNext={() =>
              setCursor(
                new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)
              )
            }
          />
        </section>

        <section className="overflow-hidden rounded-3xl border border-zinc-200/90 bg-white/95 p-5 shadow-lg shadow-zinc-900/[0.04] dark:border-zinc-800 dark:bg-zinc-950/80">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                {formatDayHeading(selected)}
              </p>
              <p className="text-xs text-zinc-400">{t.calendar.today}</p>
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
                  onOpen={() => {
                    setEditing(item);
                    setFormOpen(true);
                  }}
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
                  onOpen={() => {
                    setEditing(item);
                    setFormOpen(true);
                  }}
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
                  onToggle={() => toggle(item)}
                  onDelete={() => void destroy(item)}
                  onOpen={() => {
                    setEditing(item);
                    setFormOpen(true);
                    if (item.startsAt) {
                      const d = new Date(item.startsAt);
                      setSelected(d);
                      setCursor(new Date(d.getFullYear(), d.getMonth(), 1));
                    }
                  }}
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
