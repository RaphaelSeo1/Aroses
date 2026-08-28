"use client";

import type { CalendarItem } from "@/types/calendar";
import { formatTime, itemDateKey, localDateKey } from "@/lib/calendar/dates";
import { useT } from "@/lib/i18n/LocaleProvider";

export function CalendarItemRow({
  item,
  compact = false,
  onToggle,
  onDelete,
  onOpen,
}: {
  item: CalendarItem;
  compact?: boolean;
  onToggle?: () => void;
  onDelete?: () => void;
  onOpen?: () => void;
}) {
  const t = useT();
  const today = localDateKey(new Date());
  const dateKey = itemDateKey(item.startsAt);
  const overdue =
    Boolean(dateKey && dateKey < today && !item.completedAt && item.kind === "todo");
  const timeLabel =
    item.startsAt && !item.allDay && item.kind === "event"
      ? formatTime(item.startsAt)
      : null;
  const meta = [
    overdue ? t.calendar.overdue : null,
    timeLabel,
    !overdue && !timeLabel && !compact ? t.calendar.noTime : null,
    item.important ? t.calendar.important : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className={`group flex items-start gap-2 rounded-xl px-2 py-1.5 ${
        item.completedAt ? "opacity-55" : ""
      } ${item.important && !item.completedAt ? "bg-brand-blush/40 dark:bg-brand-blush/10" : ""}`}
    >
      {item.kind === "todo" && onToggle ? (
        <button
          type="button"
          onClick={onToggle}
          aria-label={t.calendar.done}
          className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
            item.completedAt
              ? "border-emerald-500 bg-emerald-500 text-white"
              : "border-zinc-300 bg-white dark:border-zinc-600 dark:bg-zinc-900"
          }`}
        >
          {item.completedAt ? (
            <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" aria-hidden>
              <path
                d="M3.5 8.5 6.5 11.5 12.5 4.5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : null}
        </button>
      ) : (
        <span
          className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
            item.important ? "bg-brand" : "bg-sky-400"
          }`}
          aria-hidden
        />
      )}
      <button
        type="button"
        onClick={onOpen}
        className="min-w-0 flex-1 text-left"
      >
        <p
          className={`text-[13px] font-medium leading-snug text-zinc-800 dark:text-zinc-100 ${
            item.completedAt ? "line-through" : ""
          }`}
        >
          {item.title}
        </p>
        {meta ? (
          <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
            {meta}
          </p>
        ) : null}
      </button>
      {onDelete ? (
        <button
          type="button"
          onClick={onDelete}
          className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] text-zinc-400 opacity-0 transition hover:bg-zinc-100 hover:text-zinc-700 group-hover:opacity-100 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          aria-label={t.calendar.delete}
        >
          ×
        </button>
      ) : null}
    </div>
  );
}
