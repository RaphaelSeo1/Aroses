"use client";

import { useEffect, useRef, useState } from "react";

export type AiActivityEntry = {
  id: string;
  at: number;
  kind: "thought" | "append" | "revise" | "status" | "error";
  message: string;
};

const HEIGHT_KEY = "aroses.liveNotes.aiLogHeight";
const DEFAULT_H = 144;
const MIN_H = 80;
const MAX_H = 360;

function kindLabel(kind: AiActivityEntry["kind"]): string {
  switch (kind) {
            case "thought":
      return "Noticing";
    case "append":
      return "Writing";
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
  const dragRef = useRef<{
    pointerId: number;
    startY: number;
    origH: number;
  } | null>(null);
  const [height, setHeight] = useState(DEFAULT_H);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(HEIGHT_KEY);
      if (raw) {
        const n = Number(raw);
        if (Number.isFinite(n)) {
          setHeight(Math.min(MAX_H, Math.max(MIN_H, n)));
        }
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !open) return;
    el.scrollTop = el.scrollHeight;
  }, [entries, open, height]);

  if (entries.length === 0 && !active) return null;

  const onResizeDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      pointerId: e.pointerId,
      startY: e.clientY,
      origH: height,
    };
  };

  const onResizeMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    // Drag handle sits above the log — dragging up grows height.
    const next = Math.min(
      MAX_H,
      Math.max(MIN_H, d.origH - (e.clientY - d.startY))
    );
    setHeight(next);
  };

  const onResizeUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    dragRef.current = null;
    try {
      localStorage.setItem(HEIGHT_KEY, String(height));
    } catch {
      /* ignore */
    }
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="relative shrink-0 border-t border-zinc-200 bg-white/95 dark:border-zinc-800 dark:bg-zinc-950/95">
      {open ? (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize Rose activity log"
          title="Drag to resize"
          className="absolute inset-x-0 -top-1 z-10 flex h-2 cursor-ns-resize items-center justify-center"
          onPointerDown={onResizeDown}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeUp}
          onPointerCancel={onResizeUp}
        >
          <span className="h-0.5 w-8 rounded-full bg-zinc-300 dark:bg-zinc-600" />
        </div>
      ) : null}

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
          {open ? "Minimize" : "Expand"}
        </span>
      </button>

      {open ? (
        <div
          ref={scrollRef}
          className="space-y-2 overflow-y-auto border-t border-zinc-100 px-4 py-3 dark:border-zinc-800 sm:px-5"
          style={{ height }}
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
