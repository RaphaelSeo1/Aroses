"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { AI_ASSISTANT_NAME } from "@/lib/brand";
import { useT } from "@/lib/i18n/LocaleProvider";
import type { CalendarItem } from "@/types/calendar";

type Turn = { id: string; role: "user" | "assistant"; content: string };

export function CalendarRoseChat({
  onItems,
  autoFocus = false,
}: {
  onItems: (items: CalendarItem[]) => void;
  autoFocus?: boolean;
}) {
  const t = useT();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    try {
      sessionStorage.removeItem("aroses.calendar.chat");
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns, busy]);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busy) return;
    setDraft("");
    setBusy(true);
    const userTurn: Turn = {
      id: `u-${Date.now()}`,
      role: "user",
      content: message,
    };
    const history = [...turns, userTurn]
      .filter((x) => x.content.trim())
      .slice(-12)
      .map((x) => ({ role: x.role, content: x.content }));
    setTurns((prev) => [...prev, userTurn]);

    try {
      const res = await fetch("/api/calendar/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          history: history.slice(0, -1),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          nowIso: new Date().toISOString(),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        reply?: string;
        items?: CalendarItem[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || t.calendar.roseError);
      if (Array.isArray(data.items)) onItems(data.items);
      setTurns((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: data.reply?.trim() || t.calendar.roseEmpty,
        },
      ]);
    } catch (e) {
      setTurns((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          content:
            e instanceof Error && e.message ? e.message : t.calendar.roseError,
        },
      ]);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send(draft);
  };

  const suggestions = [
    t.calendar.suggestionDue,
    t.calendar.suggestionAdd,
    t.calendar.suggestionClear,
  ];

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border border-zinc-200/90 bg-white/95 shadow-lg shadow-zinc-900/[0.05] ring-1 ring-white/50 dark:border-zinc-800 dark:bg-zinc-950/80 dark:ring-zinc-700/30">
      <header className="border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          {t.calendar.roseTitle}
        </p>
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
          {t.calendar.roseHint}
        </p>
      </header>
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3"
      >
        {turns.length === 0 && !busy ? (
          <div>
            <p className="text-[13px] leading-relaxed text-zinc-500 dark:text-zinc-400">
              {t.calendar.roseEmpty}
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void send(s)}
                  className="rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          turns.map((turn) => (
            <div
              key={turn.id}
              className={
                turn.role === "user"
                  ? "ml-6 rounded-2xl bg-brand-blush/70 px-3 py-2 text-[13px] text-brand-ink dark:bg-brand-blush/15 dark:text-brand-soft"
                  : "mr-4 text-[13px] leading-relaxed text-zinc-800 dark:text-zinc-100"
              }
            >
              {turn.role === "assistant" ? (
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                  {AI_ASSISTANT_NAME}
                </p>
              ) : null}
              <p className="whitespace-pre-wrap">{turn.content}</p>
            </div>
          ))
        )}
        {busy ? (
          <p className="text-[12px] text-zinc-400">{AI_ASSISTANT_NAME}…</p>
        ) : null}
      </div>
      <form
        onSubmit={onSubmit}
        className="border-t border-zinc-100 p-3 dark:border-zinc-800"
      >
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, 2000))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(draft);
            }
          }}
          rows={2}
          placeholder={t.calendar.rosePlaceholder}
          className="w-full resize-none rounded-xl border border-zinc-200 bg-white px-3 py-2 text-[13px] text-zinc-800 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        />
        <div className="mt-2 flex justify-end">
          <button
            type="submit"
            disabled={busy || !draft.trim()}
            className="rounded-full bg-brand px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-brand-hover disabled:opacity-40"
          >
            {t.calendar.askRose}
          </button>
        </div>
      </form>
    </section>
  );
}
