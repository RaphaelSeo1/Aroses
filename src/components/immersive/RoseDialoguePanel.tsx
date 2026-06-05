"use client";

import { useEffect, useRef } from "react";
import { StudyChatMessageMarkdown } from "@/components/StudyChatMessageMarkdown";
import type { TranscriptLine } from "@/components/immersive/TranscriptPanel";

/**
 * Scrollable Rose dialogue — lives below the course source text with a
 * hard visual boundary. History accumulates across turns within a module.
 */
export function RoseDialoguePanel({ lines }: { lines: TranscriptLine[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const visible = lines.filter((l) => l.streaming || l.text.trim().length > 0);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <div aria-label="Lesson dialogue">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
          Dialogue
        </span>
        <span className="text-[10px] text-zinc-400">
          {visible.length === 0 ? "Waiting…" : `${visible.length} messages`}
        </span>
      </div>
      <div
        ref={scrollRef}
        className="max-h-56 overflow-y-auto overscroll-y-contain rounded-xl bg-zinc-50/80 px-2 py-2 ring-1 ring-zinc-200/60"
      >
        {visible.length === 0 ? (
          <p className="py-3 text-center text-[12px] text-zinc-500">
            Rose&apos;s questions and your answers will show up here.
          </p>
        ) : (
          <ul className="space-y-2">
            {visible.map((line) => (
              <li
                key={line.id}
                className={
                  line.role === "student"
                    ? "flex justify-end"
                    : line.role === "system"
                      ? "flex justify-center"
                      : "flex justify-start"
                }
              >
                {line.role === "system" ? (
                  <span className="rounded-full bg-white px-2.5 py-0.5 text-[10px] font-medium text-zinc-500 ring-1 ring-zinc-200/80">
                    {line.text}
                  </span>
                ) : (
                  <div
                    className={
                      line.role === "student"
                        ? "max-w-[92%] rounded-xl rounded-br-sm bg-zinc-800 px-3 py-2 text-[13px] leading-snug text-white"
                        : line.kind === "question"
                          ? "max-w-[92%] rounded-xl rounded-bl-sm border border-amber-200/80 bg-gradient-to-br from-amber-50 via-white to-amber-100/80 px-3 py-2 text-[13px] leading-snug text-zinc-800"
                          : "max-w-[92%] rounded-xl rounded-bl-sm border border-fuchsia-200/55 bg-fuchsia-50/90 px-3 py-2 text-[13px] leading-snug text-zinc-800"
                    }
                  >
                    <p className="mb-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] opacity-70">
                      {line.role === "student"
                        ? "You"
                        : line.kind === "question"
                          ? "Rose"
                          : "Rose"}
                      {line.streaming ? " · …" : ""}
                    </p>
                    {line.text.trim() ? (
                      <StudyChatMessageMarkdown source={line.text} />
                    ) : line.streaming ? (
                      <span className="text-zinc-400">…</span>
                    ) : null}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
