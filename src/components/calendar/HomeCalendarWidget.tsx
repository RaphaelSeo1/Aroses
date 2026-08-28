"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CalendarItemRow } from "@/components/calendar/CalendarItemRow";
import { CalendarMonthGrid } from "@/components/calendar/CalendarMonthGrid";
import { useCalendarItems } from "@/components/calendar/use-calendar-items";
import {
  isoFromLocalDateKey,
  itemDateKey,
  localDateKey,
} from "@/lib/calendar/dates";
import { useT } from "@/lib/i18n/LocaleProvider";

export function HomeCalendarWidget() {
  const t = useT();
  const { items, loading, error, add, patch, remove } = useCalendarItems();
  const [cursor, setCursor] = useState(() => new Date());
  const [selected, setSelected] = useState(() => new Date());
  const [draft, setDraft] = useState("");
  const selectedKey = localDateKey(selected);

  const markedKeys = useMemo(() => {
    const set = new Set<string>();
    for (const item of items) {
      const key = itemDateKey(item.startsAt);
      if (key) set.add(key);
    }
    return set;
  }, [items]);

  const dayItems = useMemo(() => {
    return items
      .filter((i) => itemDateKey(i.startsAt) === selectedKey)
      .sort((a, b) => {
        if (a.completedAt && !b.completedAt) return 1;
        if (!a.completedAt && b.completedAt) return -1;
        return (a.startsAt ?? "").localeCompare(b.startsAt ?? "");
      });
  }, [items, selectedKey]);

  const openTodos = useMemo(
    () =>
      items.filter(
        (i) => i.kind === "todo" && !i.completedAt && !i.startsAt
      ),
    [items]
  );

  const submitQuick = async () => {
    const title = draft.trim();
    if (!title) return;
    setDraft("");
    try {
      await add({
        title,
        kind: "todo",
        startsAt: isoFromLocalDateKey(selectedKey),
        allDay: true,
      });
    } catch {
      setDraft(title);
    }
  };

  return (
    <section className="overflow-hidden rounded-3xl border border-zinc-200/90 bg-white/95 p-5 shadow-lg shadow-zinc-900/[0.05] ring-1 ring-white/50 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-950/80 dark:ring-zinc-700/30">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            {t.calendar.title}
          </p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            {t.calendar.subtitle}
          </p>
        </div>
        <Link
          href="/calendar"
          className="shrink-0 rounded-full bg-brand px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-brand-hover"
        >
          {t.calendar.expand}
        </Link>
      </div>

      <div className="mt-4">
        <CalendarMonthGrid
          compact
          cursor={cursor}
          selected={selected}
          markedKeys={markedKeys}
          onSelect={(d) => {
            setSelected(d);
            setCursor(new Date(d.getFullYear(), d.getMonth(), 1));
          }}
          onPrev={() =>
            setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))
          }
          onNext={() =>
            setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))
          }
        />
      </div>

      <div className="mt-4 max-h-48 space-y-0.5 overflow-y-auto">
        {loading ? (
          <p className="px-2 py-3 text-[12px] text-zinc-400">{t.common.loading}</p>
        ) : error ? (
          <p className="px-2 py-3 text-[12px] text-red-600">{t.calendar.loadError}</p>
        ) : dayItems.length === 0 && openTodos.length === 0 ? (
          <p className="px-2 py-3 text-[12px] text-zinc-400">
            {t.calendar.emptyDay}
          </p>
        ) : (
          <>
            {dayItems.map((item) => (
              <CalendarItemRow
                key={item.id}
                item={item}
                compact
                onToggle={() =>
                  void patch(item.id, {
                    completedAt: item.completedAt
                      ? null
                      : new Date().toISOString(),
                  })
                }
                onDelete={() => void remove(item.id)}
              />
            ))}
            {openTodos.length > 0 ? (
              <p className="px-2 pt-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                {t.calendar.unscheduled}
              </p>
            ) : null}
            {openTodos.slice(0, 4).map((item) => (
              <CalendarItemRow
                key={item.id}
                item={item}
                compact
                onToggle={() =>
                  void patch(item.id, {
                    completedAt: item.completedAt
                      ? null
                      : new Date().toISOString(),
                  })
                }
                onDelete={() => void remove(item.id)}
              />
            ))}
          </>
        )}
      </div>

      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submitQuick();
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, 200))}
          placeholder={t.calendar.addTodoPlaceholder}
          className="min-w-0 flex-1 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-[12px] text-zinc-800 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        />
        <button
          type="submit"
          disabled={!draft.trim()}
          className="rounded-full bg-zinc-900 px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {t.calendar.add}
        </button>
      </form>
      <Link
        href="/calendar?chat=1"
        className="mt-3 inline-flex text-[11px] font-semibold text-brand hover:underline dark:text-brand-soft"
      >
        {t.calendar.askRose} →
      </Link>
    </section>
  );
}
