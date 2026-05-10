"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { StudyChatTurn } from "@/types/study-chat";

type Props = {
  materialId: string;
  moduleId: number;
  quizOpen: boolean;
  /** Stack inside parent dock instead of separate fixed positions */
  docked?: boolean;
  /** Legacy study pack (summary + 10 MCQs) vs full course player */
  variant?: "course" | "legacy";
};

export function StudyChatDrawer({
  materialId,
  moduleId,
  quizOpen,
  docked = false,
  variant = "course",
}: Props) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<StudyChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMessages([]);
    setError(null);
  }, [moduleId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open, loading]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    const prevSnapshot = messages;
    const nextMessages: StudyChatTurn[] = [
      ...prevSnapshot,
      { role: "user", content: text },
    ];

    setError(null);
    setMessages(nextMessages);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/study-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          materialId,
          moduleId,
          quizOpen,
          messages: nextMessages,
        }),
      });
      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(
          typeof body.error === "string"
            ? body.error
            : "Something went wrong."
        );
        setMessages(prevSnapshot);
        setInput(text);
        return;
      }

      const reply = body.reply as string | undefined;
      if (typeof reply !== "string") {
        setError("Bad response.");
        setMessages(prevSnapshot);
        setInput(text);
        return;
      }

      setMessages([
        ...nextMessages,
        { role: "assistant", content: reply },
      ]);
    } catch {
      setError("Network error.");
      setMessages(prevSnapshot);
      setInput(text);
    } finally {
      setLoading(false);
    }
  }, [input, loading, materialId, moduleId, quizOpen, messages]);

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={
            docked
              ? "min-w-[11rem] rounded-2xl bg-brand px-5 py-3 text-sm font-semibold text-white shadow-xl shadow-red-600/25 ring-1 ring-white/10 transition hover:bg-brand-hover dark:bg-brand dark:hover:bg-brand-soft"
              : "fixed bottom-6 right-6 z-[100] min-w-[11rem] rounded-2xl bg-brand px-5 py-3 text-sm font-semibold text-white shadow-xl shadow-red-600/25 ring-1 ring-white/10 hover:bg-brand-hover dark:bg-brand dark:hover:bg-brand-soft"
          }
        >
          Ask AI
        </button>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-zinc-950/50 p-0 backdrop-blur-[2px] sm:p-4 sm:pl-12"
          role="dialog"
          aria-label="Study assistant chat"
          onClick={() => setOpen(false)}
        >
          <div
            className="flex h-full w-full max-w-md flex-col bg-white shadow-2xl dark:bg-zinc-950 sm:h-[min(580px,calc(100vh-2rem))] sm:max-h-[calc(100vh-2rem)] sm:rounded-3xl sm:ring-1 sm:ring-zinc-200/80 dark:sm:ring-zinc-700"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-brand-border bg-gradient-to-r from-brand-blush/90 to-white px-5 py-4 dark:border-brand-border/40 dark:from-[#1e1616]/40 dark:to-zinc-950">
              <div>
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                  Study assistant
                </p>
                <p className="text-[11px] text-zinc-500">
                  {variant === "legacy"
                    ? "Answers use your summary and practice questions only."
                    : `Answers use this module’s content only.${quizOpen ? " Quiz mode: won’t reveal MCQ answers." : ""}`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
              >
                Close
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
              {messages.length === 0 && (
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  Ask anything about what you&apos;re viewing — definitions,
                  intuition, or how ideas connect. It only knows what&apos;s in
                  your generated course.
                </p>
              )}
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[90%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                      m.role === "user"
                        ? "bg-brand text-white"
                        : "bg-zinc-100 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100"
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{m.content}</p>
                  </div>
                </div>
              ))}
              {loading && (
                <p className="text-xs text-zinc-500">Thinking…</p>
              )}
              {error && (
                <p className="text-sm text-red-600 dark:text-red-400">
                  {error}
                </p>
              )}
              <div ref={bottomRef} />
            </div>

            <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
              <div className="flex gap-2">
                <textarea
                  rows={2}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  placeholder="Ask a question…"
                  className="min-h-[44px] flex-1 resize-none rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none ring-brand placeholder:text-zinc-400 focus:border-brand focus:ring-2 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                  disabled={loading}
                />
                <button
                  type="button"
                  disabled={loading || !input.trim()}
                  onClick={() => void send()}
                  className="shrink-0 self-end rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
                >
                  Send
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
