"use client";

import { useState, type FormEvent } from "react";
import { CalendarItemRow } from "@/components/calendar/CalendarItemRow";
import { CALENDAR_DND_TYPE } from "@/lib/calendar/grid";
import { useT } from "@/lib/i18n/LocaleProvider";
import type { CalendarItem } from "@/types/calendar";

export function CalendarTodoList({
  items,
  loading,
  error,
  onAdd,
  onToggle,
  onDelete,
  onOpen,
}: {
  items: CalendarItem[];
  loading?: boolean;
  error?: string | null;
  onAdd: (title: string) => Promise<void>;
  onToggle: (item: CalendarItem) => void;
  onDelete: (item: CalendarItem) => void;
  onOpen: (item: CalendarItem) => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [showDone, setShowDone] = useState(false);

  const open = items.filter((i) => !i.completedAt);
  const done = items.filter((i) => i.completedAt);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const title = draft.trim();
    if (!title || busy) return;
    setBusy(true);
    try {
      await onAdd(title);
      setDraft("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="overflow-hidden rounded-3xl border border-zinc-200/90 bg-white/95 p-5 shadow-lg shadow-zinc-900/[0.04] dark:border-zinc-800 dark:bg-zinc-950/80">
      <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
        {t.calendar.todosTitle}
      </p>
      <p className="mt-0.5 text-xs text-zinc-400">{t.calendar.todosHint}</p>
      <form onSubmit={(e) => void submit(e)} className="mt-3 flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, 200))}
          placeholder={t.calendar.addTodoPlaceholder}
          className="min-w-0 flex-1 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
        <button
          type="submit"
          disabled={busy || !draft.trim()}
          className="rounded-full bg-brand px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-brand-hover disabled:opacity-40"
        >
          {t.calendar.add}
        </button>
      </form>
      <div className="mt-3 space-y-0.5">
        {loading ? (
          <p className="py-3 text-sm text-zinc-400">{t.common.loading}</p>
        ) : error ? (
          <p className="py-3 text-sm text-red-600">{error}</p>
        ) : open.length === 0 ? (
          <p className="py-3 text-sm text-zinc-400">{t.calendar.emptyTodos}</p>
        ) : (
          open.map((item) => (
            <div
              key={item.id}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(CALENDAR_DND_TYPE, item.id);
                e.dataTransfer.effectAllowed = "move";
              }}
              className="cursor-grab"
            >
              <CalendarItemRow
                item={item}
                showDate={Boolean(item.startsAt)}
                onToggle={() => onToggle(item)}
                onDelete={() => onDelete(item)}
                onOpen={() => onOpen(item)}
              />
            </div>
          ))
        )}
      </div>
      {done.length > 0 ? (
        <div className="mt-3 border-t border-zinc-100 pt-2 dark:border-zinc-800">
          <button
            type="button"
            onClick={() => setShowDone((v) => !v)}
            className="text-[12px] font-semibold text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
          >
            {showDone
              ? t.calendar.hideCompleted
              : `${t.calendar.showCompleted} (${done.length})`}
          </button>
          {showDone
            ? done.map((item) => (
                <CalendarItemRow
                  key={item.id}
                  item={item}
                  showDate={Boolean(item.startsAt)}
                  onToggle={() => onToggle(item)}
                  onDelete={() => onDelete(item)}
                  onOpen={() => onOpen(item)}
                />
              ))
            : null}
        </div>
      ) : null}
    </section>
  );
}
