"use client";

import { useEffect, useRef } from "react";

export type AiActivityEntry = {
  id: string;
  at: number;
  kind: "thought" | "append" | "revise" | "status" | "error";
  message: string;
};

function kindLabel(kind: AiActivityEntry["kind"]): string {
  switch (kind) {
    case "thought":
      return "Thinking";
    case "append":
      return "Adding notes";
    case "revise":
      return "Correcting";
    case "error":
      return "Issue";
    default:
      return "Working";
  }
}

function kindDotClass(kind: AiActivityEntry["kind"]): string {
  switch (kind) {
    case "thought":
      return "bg-violet-500";
    case "append":
      return "bg-emerald-500";
    case "revise":
      return "bg-amber-500";
    case "error":
      return "bg-rose-500";
    default:
      return "bg-zinc-400";
  }
}

export function LiveNotesAiActivity({
  entries,
  active,
  open,
  onOpenChange,
}: {
  entries: AiActivityEntry[];
  active: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !open) return;
    el.scrollTop = el.scrollHeight;
  }, [entries, open]);

  if (entries.length === 0 && !active) return null;

  return (
    <div className="shrink-0 border-t border-zinc-200 bg-white/95 dark:border-zinc-800 dark:bg-zinc-950/95">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900/60 sm:px-5"
        aria-expanded={open}
      >
        <span className="flex min-w-0 items-center gap-2">
          {active ? (
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-500 opacity-50" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-violet-500" />
            </span>
          ) : (
            <span className="h-2 w-2 shrink-0 rounded-full bg-zinc-300 dark:bg-zinc-600" />
          )}
          <span className="truncate text-xs font-semibold text-zinc-800 dark:text-zinc-100">
            {active ? "Rose is working on your notes" : "Rose's note-taking log"}
          </span>
        </span>
        <span className="shrink-0 text-[11px] font-medium text-zinc-400">
          {open ? "Hide" : "Show"}
        </span>
      </button>

      {open ? (
        <div
          ref={scrollRef}
          className="max-h-36 space-y-2 overflow-y-auto border-t border-zinc-100 px-4 py-3 dark:border-zinc-800 sm:px-5"
          aria-live="polite"
        >
          {entries.length === 0 ? (
            <p className="text-xs leading-relaxed text-zinc-400 dark:text-zinc-500">
              Waiting for the next slice of the lecture…
            </p>
          ) : (
            entries.map((entry) => (
              <div key={entry.id} className="flex gap-2.5">
                <span
                  className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${kindDotClass(entry.kind)}`}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                    {kindLabel(entry.kind)}
                  </p>
                  <p className="text-xs leading-relaxed text-zinc-700 dark:text-zinc-300">
                    {entry.message}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
