"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { StudyChatMessageMarkdown } from "@/components/StudyChatMessageMarkdown";
import { AI_ASSISTANT_NAME } from "@/lib/brand";
import type { StudyChatResponse, StudyChatTurn } from "@/types/study-chat";

export const STUDY_CHAT_PREFILL_EVENT = "aroses-study-chat-prefill";

export type StudyChatPrefillDetail = {
  materialId?: string;
  moduleId?: number;
  text: string;
};

type Props = {
  materialId: string;
  moduleId: number;
  quizOpen: boolean;
  /** Base lessons URL (e.g. `/dashboard/courses/:id/study` or `/explore/:id/study`). */
  studyHrefBase?: string;
  /** Keep `mode=learn` when navigating (dashboard “study as learner”). */
  learnMode?: boolean;
  /** Stack inside parent dock instead of separate fixed positions */
  docked?: boolean;
  /** Legacy study pack (summary + 10 MCQs) vs full course player */
  variant?: "course" | "legacy";
};

export function StudyChatDrawer({
  materialId,
  moduleId,
  quizOpen,
  studyHrefBase,
  learnMode = false,
  docked = false,
  variant = "course",
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<StudyChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMessages([]);
    setError(null);
  }, [moduleId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open, loading]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      panelRef.current?.querySelector<HTMLElement>("textarea")?.focus();
    }, 100);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    const onPrefill = (event: Event) => {
      const detail = (event as CustomEvent<StudyChatPrefillDetail>).detail;
      if (!detail?.text?.trim()) return;
      if (detail.materialId && detail.materialId !== materialId) return;
      if (
        typeof detail.moduleId === "number" &&
        Number.isFinite(detail.moduleId) &&
        detail.moduleId !== moduleId
      ) {
        return;
      }
      setInput(detail.text.trim());
      setOpen(true);
    };
    window.addEventListener(STUDY_CHAT_PREFILL_EVENT, onPrefill);
    return () => window.removeEventListener(STUDY_CHAT_PREFILL_EVENT, onPrefill);
  }, [materialId, moduleId]);

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

      const payload = body as Partial<StudyChatResponse> & { error?: unknown };
      const reply = payload.reply;
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

      const action = payload.action ?? null;
      if (
        action &&
        typeof action === "object" &&
        ((action as { type?: unknown }).type === "navigate_to_module" ||
          (action as { type?: unknown }).type === "navigate_to_location") &&
        variant === "course" &&
        typeof studyHrefBase === "string" &&
        studyHrefBase.length > 0
      ) {
        const targetModule =
          (action as { moduleId?: unknown }).moduleId;
        const targetMaterial =
          (action as { type?: unknown }).type === "navigate_to_location" &&
          typeof (action as { materialId?: unknown }).materialId === "string"
            ? (action as { materialId: string }).materialId
            : materialId;
        if (typeof targetModule !== "number" || !Number.isFinite(targetModule)) {
          return;
        }
        const p = new URLSearchParams();
        p.set("material", targetMaterial);
        p.set("module", String(targetModule));
        if (learnMode) p.set("mode", "learn");
        router.push(`${studyHrefBase}?${p.toString()}`);
        setOpen(false);
      }
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
          Ask {AI_ASSISTANT_NAME}!
        </button>
      )}

      {open ? (
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="false"
          aria-label={`${AI_ASSISTANT_NAME} study chat`}
          className="fixed top-14 right-0 z-[100] flex h-[calc(100vh-3.5rem)] w-[min(100vw-12px,22rem)] flex-col border-l border-zinc-200/95 bg-white dark:border-zinc-700 dark:bg-zinc-950 sm:top-16 sm:h-[calc(100vh-4rem)] sm:w-[min(100vw-16px,26rem)]"
          style={{
            boxShadow:
              "-12px 0 40px -12px rgba(0,0,0,0.12), -4px 0 16px rgba(0,0,0,0.06)",
          }}
        >
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-brand-border bg-gradient-to-r from-brand-blush/90 to-white px-4 py-3 dark:border-brand-border/40 dark:from-[#1e1616]/40 dark:to-zinc-950 sm:px-5 sm:py-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                {AI_ASSISTANT_NAME}
              </p>
              <p className="text-[11px] leading-snug text-zinc-500">
                {variant === "legacy"
                  ? "Uses your summary and practice questions only."
                  : `Side-by-side with your lesson.${quizOpen ? " Quiz mode: won’t reveal MCQ answers." : ""}`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="shrink-0 rounded-lg px-2.5 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
            >
              Close
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
            {messages.length === 0 ? (
              <div className="space-y-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                <p>{`Ask ${AI_ASSISTANT_NAME} anything about what you're viewing — definitions, intuition, or how ideas connect.`}</p>
                {variant === "course" && (
                  <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-900">
                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                      Try asking
                    </p>
                    <ul className="space-y-1 text-[12px] text-zinc-500 dark:text-zinc-400">
                      <li className="cursor-pointer hover:text-zinc-800 dark:hover:text-zinc-200" onClick={() => setInput("Take me to the module about carbohydrates")}>
                        "Take me to the module about carbohydrates"
                      </li>
                      <li className="cursor-pointer hover:text-zinc-800 dark:hover:text-zinc-200" onClick={() => setInput("Which module covers DNA replication?")}>
                        "Which module covers DNA replication?"
                      </li>
                      <li className="cursor-pointer hover:text-zinc-800 dark:hover:text-zinc-200" onClick={() => setInput("Explain this concept in simpler terms")}>
                        "Explain this in simpler terms"
                      </li>
                    </ul>
                  </div>
                )}
              </div>
            ) : null}
            {messages.map((m, i) => (
              <div
                key={i}
                className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[95%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                    m.role === "user"
                      ? "bg-brand text-white"
                      : "bg-zinc-100 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100"
                  }`}
                >
                  {m.role === "user" ? (
                    <p className="whitespace-pre-wrap">{m.content}</p>
                  ) : (
                    <StudyChatMessageMarkdown source={m.content} />
                  )}
                </div>
              </div>
            ))}
            {loading ? (
              <p className="text-xs text-zinc-500">Thinking…</p>
            ) : null}
            {error ? (
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            ) : null}
            <div ref={bottomRef} />
          </div>

          <div className="shrink-0 border-t border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
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
                placeholder={`Ask ${AI_ASSISTANT_NAME}…`}
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
      ) : null}
    </>
  );
}
