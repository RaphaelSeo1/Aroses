"use client";

import {
  localDateKey,
  monthCells,
  monthTitle,
  sameDay,
  weekdayShort,
} from "@/lib/calendar/dates";
import { CALENDAR_DND_TYPE } from "@/lib/calendar/grid";
import { useT } from "@/lib/i18n/LocaleProvider";
import type { CalendarItem } from "@/types/calendar";

export function CalendarMonthGrid({
  cursor,
  selected,
  markedKeys,
  onSelect,
  onPrev,
  onNext,
  compact = false,
  itemsByDay,
  onOpenItem,
  onDropItem,
}: {
  cursor: Date;
  selected: Date;
  markedKeys: Set<string>;
  onSelect: (d: Date) => void;
  onPrev: () => void;
  onNext: () => void;
  compact?: boolean;
  itemsByDay?: Map<string, CalendarItem[]>;
  onOpenItem?: (item: CalendarItem) => void;
  onDropItem?: (itemId: string, day: Date) => void;
}) {
  const t = useT();
  const cells = monthCells(cursor.getFullYear(), cursor.getMonth());
  const today = new Date();
  const headers = [0, 1, 2, 3, 4, 5, 6].map((i) =>
    weekdayShort(new Date(2026, 7, 2 + i)).slice(0, compact ? 1 : 3)
  );

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onPrev}
          className="rounded-full px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          aria-label={t.calendar.monthPrev}
        >
          ‹
        </button>
        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          {monthTitle(cursor)}
        </p>
        <button
          type="button"
          onClick={onNext}
          className="rounded-full px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          aria-label={t.calendar.monthNext}
        >
          ›
        </button>
      </div>
      {compact ? (
        <div className="mt-1.5 grid grid-cols-7 gap-0 text-center">
          {headers.map((h, i) => (
            <div
              key={`${h}-${i}`}
              className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400"
            >
              {h}
            </div>
          ))}
          {cells.map((d) => {
            const key = localDateKey(d);
            const inMonth = d.getMonth() === cursor.getMonth();
            const isToday = sameDay(d, today);
            const isSelected = sameDay(d, selected);
            const marked = markedKeys.has(key);
            return (
              <button
                key={key + d.getMonth()}
                type="button"
                onClick={() => onSelect(d)}
                className={[
                  "relative mx-auto flex h-6 w-6 items-center justify-center rounded-full text-[10px] tabular-nums",
                  inMonth
                    ? "text-zinc-800 dark:text-zinc-100"
                    : "text-zinc-300 dark:text-zinc-600",
                  isSelected
                    ? "bg-brand font-semibold text-white"
                    : isToday
                      ? "ring-1 ring-brand/50"
                      : "hover:bg-zinc-100 dark:hover:bg-zinc-800",
                ].join(" ")}
              >
                {d.getDate()}
                {marked && !isSelected ? (
                  <span className="absolute bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-brand" />
                ) : null}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-7 gap-px overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-200 dark:border-zinc-800 dark:bg-zinc-800">
          {headers.map((h, i) => (
            <div
              key={`${h}-${i}`}
              className="bg-zinc-50 py-1 text-center text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:bg-zinc-900"
            >
              {h}
            </div>
          ))}
          {cells.map((d) => {
            const key = localDateKey(d);
            const inMonth = d.getMonth() === cursor.getMonth();
            const isToday = sameDay(d, today);
            const isSelected = sameDay(d, selected);
            const list = (itemsByDay?.get(key) ?? []).filter((i) => !i.completedAt);
            const extra = list.length > 3 ? list.length - 3 : 0;
            return (
              <div
                key={key + d.getMonth()}
                onClick={() => onSelect(d)}
                onDragOver={(e) => {
                  if (!onDropItem) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                }}
                onDrop={(e) => {
                  if (!onDropItem) return;
                  e.preventDefault();
                  e.stopPropagation();
                  const id = e.dataTransfer.getData(CALENDAR_DND_TYPE);
                  if (id) onDropItem(id, d);
                }}
                className={[
                  "min-h-[6.75rem] cursor-pointer bg-white p-1 text-left dark:bg-zinc-950",
                  isSelected ? "ring-1 ring-inset ring-brand/40" : "",
                  !inMonth ? "bg-zinc-50/80 dark:bg-zinc-900/40" : "",
                ].join(" ")}
              >
                <p
                  className={[
                    "mb-1 inline-flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-semibold tabular-nums",
                    isToday
                      ? "bg-brand text-white"
                      : inMonth
                        ? "text-zinc-800 dark:text-zinc-100"
                        : "text-zinc-300 dark:text-zinc-600",
                  ].join(" ")}
                >
                  {d.getDate()}
                </p>
                <div className="space-y-0.5">
                  {list.slice(0, 3).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      draggable={Boolean(onDropItem)}
                      onDragStart={(e) => {
                        e.stopPropagation();
                        e.dataTransfer.setData(CALENDAR_DND_TYPE, item.id);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenItem?.(item);
                      }}
                      className={`block w-full truncate rounded px-1 py-0.5 text-left text-[10px] font-medium ${
                        item.important
                          ? "bg-brand text-white"
                          : item.kind === "todo"
                            ? "bg-amber-100 text-amber-950 dark:bg-amber-500/20 dark:text-amber-100"
                            : "bg-sky-100 text-sky-900 dark:bg-sky-500/20 dark:text-sky-100"
                      }`}
                    >
                      {item.title}
                    </button>
                  ))}
                  {extra > 0 ? (
                    <p className="px-1 text-[10px] text-zinc-400">+{extra}</p>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
