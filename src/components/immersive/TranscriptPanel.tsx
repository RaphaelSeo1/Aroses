"use client";

import { useEffect, useRef } from "react";
import { StudyChatMessageMarkdown } from "@/components/StudyChatMessageMarkdown";

export type TranscriptLine = {
  id: string;
  role: "student" | "rose" | "system";
  text: string;
  kind?: "default" | "question";
  /** True while Rose's reply is still streaming in. */
  streaming?: boolean;
};

/**
 * Scrollable dialogue strip above the mentored composer. Keeps the full
 * back-and-forth visible instead of replacing a single caption on each turn.
 */
export function TranscriptPanel({
  lines,
  className = "",
}: {
  lines: TranscriptLine[];
  className?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <div
      className={`rounded-2xl border border-white/70 bg-white/80 shadow-sm ring-1 ring-white/60 backdrop-blur-md ${className}`}
      aria-label="Lesson dialogue"
    >
      <div className="flex items-center justify-between gap-2 border-b border-white/60 px-3 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
          Dialogue
        </span>
        <span className="text-[10px] text-zinc-400">
          {lines.length === 0 ? "Waiting…" : `${lines.length} messages`}
        </span>
      </div>
      <div
        ref={scrollRef}
        className="max-h-[min(11rem,22vh)] overflow-y-auto overscroll-y-contain px-3 py-2"
      >
        {lines.length === 0 ? (
          <p className="py-2 text-center text-[12px] text-zinc-500">
            Rose&apos;s replies and your answers will show up here.
          </p>
        ) : (
          <ul className="space-y-2">
            {lines.map((line) => (
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
                  <span className="rounded-full bg-zinc-100/90 px-2.5 py-0.5 text-[10px] font-medium text-zinc-500">
                    {line.text}
                  </span>
                ) : (
                  <div
                    className={
                      line.role === "student"
                        ? "max-w-[92%] rounded-2xl rounded-br-md bg-zinc-900/90 px-3 py-2 text-[13px] leading-snug text-white"
                        : line.kind === "question"
                          ? "max-w-[92%] rounded-2xl rounded-bl-md border border-amber-200/80 bg-gradient-to-br from-amber-50 via-white to-amber-100/80 px-3 py-2 text-[13px] leading-snug text-zinc-800"
                          : "max-w-[92%] rounded-2xl rounded-bl-md border border-fuchsia-200/60 bg-fuchsia-50/90 px-3 py-2 text-[13px] leading-snug text-zinc-800"
                    }
                  >
                    <p className="mb-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] opacity-70">
                      {line.role === "student"
                        ? "You"
                        : line.kind === "question"
                          ? "Rose asks"
                          : "Rose"}
                      {line.streaming ? " · …" : ""}
                    </p>
                    <StudyChatMessageMarkdown source={line.text} />
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
