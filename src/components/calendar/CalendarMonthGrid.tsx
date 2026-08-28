"use client";

import {
  localDateKey,
  monthCells,
  monthTitle,
  sameDay,
  weekdayShort,
} from "@/lib/calendar/dates";
import { useT } from "@/lib/i18n/LocaleProvider";

export function CalendarMonthGrid({
  cursor,
  selected,
  markedKeys,
  onSelect,
  onPrev,
  onNext,
  compact = false,
}: {
  cursor: Date;
  selected: Date;
  markedKeys: Set<string>;
  onSelect: (d: Date) => void;
  onPrev: () => void;
  onNext: () => void;
  compact?: boolean;
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
      <div className="mt-3 grid grid-cols-7 gap-0.5 text-center">
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
                "relative mx-auto flex h-8 w-8 items-center justify-center rounded-full text-[12px] tabular-nums",
                inMonth
                  ? "text-zinc-800 dark:text-zinc-100"
                  : "text-zinc-300 dark:text-zinc-600",
                isSelected
                  ? "bg-brand font-semibold text-white"
                  : isToday
                    ? "ring-1 ring-brand/50"
                    : "hover:bg-zinc-100 dark:hover:bg-zinc-800",
                compact ? "h-7 w-7 text-[11px]" : "",
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
    </div>
  );
}
