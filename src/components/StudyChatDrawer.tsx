"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { StudyChatMessageMarkdown } from "@/components/StudyChatMessageMarkdown";
import { AI_ASSISTANT_NAME } from "@/lib/brand";
import {
  MAX_STORED_MESSAGES,
  loadStudyChatMessages,
  saveStudyChatMessages,
  studyChatStorageKey,
} from "@/lib/study-chat-storage";
import type { StudyChatOption, StudyChatResponse, StudyChatTurn } from "@/types/study-chat";

export const STUDY_CHAT_PREFILL_EVENT = "aroses-study-chat-prefill";

type ChatMessage = StudyChatTurn & { options?: StudyChatOption[] };

export type StudyChatPrefillDetail = {
  materialId?: string;
  moduleId?: number;
  text: string;
};

type Props = {
  materialId: string;
  moduleId: number;
  quizOpen: boolean;
  /** Persists chat across modules when set. */
  courseId?: string;
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
  courseId,
  studyHrefBase,
  learnMode = false,
  docked = false,
  variant = "course",
}: Props) {
  const router = useRouter();
  const storageKey = studyChatStorageKey(courseId, materialId, moduleId);
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMessages(loadStudyChatMessages(storageKey));
    setHydrated(true);
  }, [storageKey]);

  useEffect(() => {
    if (!hydrated) return;
    saveStudyChatMessages(storageKey, messages);
  }, [hydrated, messages, storageKey]);

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

  const navigateTo = useCallback(
    (targetMaterial: string, targetModule: number) => {
      if (variant !== "course" || !studyHrefBase) return;
      const p = new URLSearchParams();
      p.set("material", targetMaterial);
      p.set("module", String(targetModule));
      if (learnMode) p.set("mode", "learn");
      router.push(`${studyHrefBase}?${p.toString()}`);
      setOpen(false);
    },
    [learnMode, router, studyHrefBase, variant]
  );

  const send = useCallback(async (textOverride?: string) => {
    const text = (textOverride ?? input).trim();
    if (!text || loading) return;

    const prevSnapshot = messages;
    const nextMessages: ChatMessage[] = [
      ...prevSnapshot,
      { role: "user", content: text },
    ];

    setError(null);
    setMessages(nextMessages);
    if (!textOverride) setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/study-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          materialId,
          moduleId,
          quizOpen,
          messages: nextMessages
            .slice(-MAX_STORED_MESSAGES)
            .map(({ role, content }) => ({ role, content })),
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
        if (!textOverride) setInput(text);
        return;
      }

      const payload = body as Partial<StudyChatResponse> & { error?: unknown };
      const reply = payload.reply;
      if (typeof reply !== "string") {
        setError("Bad response.");
        setMessages(prevSnapshot);
        if (!textOverride) setInput(text);
        return;
      }

      const options = Array.isArray(payload.options)
        ? payload.options.filter(
            (o): o is StudyChatOption =>
              !!o &&
              typeof o === "object" &&
              typeof (o as StudyChatOption).label === "string" &&
              typeof (o as StudyChatOption).id === "string"
          )
        : undefined;

      setMessages([
        ...nextMessages,
        { role: "assistant", content: reply, options },
      ]);

      const action = payload.action ?? null;
      if (
        action &&
        typeof action === "object" &&
        (action as { type?: unknown }).type === "navigate_to_location"
      ) {
        const targetModule = (action as { moduleId?: unknown }).moduleId;
        const targetMaterial =
          typeof (action as { materialId?: unknown }).materialId === "string"
            ? (action as { materialId: string }).materialId
            : materialId;
        if (typeof targetModule === "number" && Number.isFinite(targetModule)) {
          navigateTo(targetMaterial, targetModule);
        }
      }
    } catch {
      setError("Network error.");
      setMessages(prevSnapshot);
      if (!textOverride) setInput(text);
    } finally {
      setLoading(false);
    }
  }, [
    input,
    loading,
    materialId,
    moduleId,
    quizOpen,
    messages,
    navigateTo,
  ]);

  const pickOption = useCallback(
    (option: StudyChatOption) => {
      if (option.action.type === "navigate_to_location") {
        navigateTo(option.action.materialId, option.action.moduleId);
        setMessages((prev) => [
          ...prev,
          {
            role: "user",
            content: option.label,
          },
        ]);
        return;
      }
      void send(option.label);
    },
    [navigateTo, send]
  );

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={
            docked
              ? "min-w-[11rem] rounded-full bg-brand px-5 py-3 text-sm font-semibold text-white shadow-xl shadow-rose-600/25 ring-1 ring-white/10 transition hover:bg-brand-hover dark:bg-brand dark:hover:bg-brand-soft"
              : "fixed bottom-6 right-6 z-[100] min-w-[11rem] rounded-full bg-brand px-5 py-3 text-sm font-semibold text-white shadow-xl shadow-rose-600/25 ring-1 ring-white/10 transition hover:bg-brand-hover dark:bg-brand dark:hover:bg-brand-soft"
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
          className="fixed inset-x-3 bottom-3 top-16 z-[100] flex flex-col overflow-hidden rounded-3xl border border-brand-border bg-white/95 shadow-2xl shadow-rose-900/10 backdrop-blur-xl dark:border-brand-border/40 dark:bg-zinc-950/90 sm:inset-x-auto sm:right-4 sm:bottom-4 sm:top-20 sm:w-[min(100vw-2rem,26rem)]"
        >
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-brand-border/70 bg-gradient-to-r from-brand-blush/90 to-white px-4 py-3.5 dark:border-brand-border/40 dark:from-[#1e1616]/50 dark:to-zinc-950 sm:px-5 sm:py-4">
            <div className="flex min-w-0 items-start gap-3">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-semibold text-white shadow-sm shadow-rose-900/20 ring-2 ring-white/70 dark:ring-white/10">
                {AI_ASSISTANT_NAME.slice(0, 1)}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                  {AI_ASSISTANT_NAME}
                </p>
                <p className="text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
                  {variant === "legacy"
                    ? "Uses your summary and practice questions only."
                    : `Side-by-side with your lesson — chat is saved for this course.${quizOpen ? " Active quiz: guides reasoning without giving away letters." : ""}`}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close chat"
              className="shrink-0 rounded-full px-3 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-white/70 hover:text-brand dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
            >
              Close
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-5">
            {messages.length === 0 ? (
              <div className="space-y-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                <p>{`Ask ${AI_ASSISTANT_NAME} anything about what you're viewing — definitions, intuition, or how ideas connect.`}</p>
                {variant === "course" && (
                  <div className="rounded-2xl border border-brand-border/70 bg-rose-50/70 px-4 py-3.5 dark:border-brand-border/40 dark:bg-rose-950/30">
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-brand dark:text-brand-soft">
                      Try asking
                    </p>
                    <ul className="space-y-1.5 text-[12.5px] text-zinc-600 dark:text-zinc-300">
                      {[
                        "Explain this concept in simpler terms",
                        "Walk me through an example of this",
                        "Take me to the module about carbohydrates",
                      ].map((example) => (
                        <li key={example}>
                          <button
                            type="button"
                            onClick={() => setInput(example)}
                            className="w-full rounded-xl px-3 py-2 text-left transition hover:bg-white/80 hover:text-brand dark:hover:bg-zinc-900/60 dark:hover:text-brand-soft"
                          >
                            {`“${example.charAt(0).toLowerCase() + example.slice(1)}”`}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : null}
            {messages.map((m, i) => (
              <div
                key={i}
                className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}
              >
                <div
                  className={`max-w-[92%] px-4 py-3 text-sm leading-relaxed shadow-sm ${
                    m.role === "user"
                      ? "rounded-3xl rounded-br-lg bg-brand text-white shadow-rose-900/15"
                      : "rounded-3xl rounded-bl-lg border border-brand-border/60 bg-rose-50/60 text-zinc-800 shadow-rose-900/[0.03] dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-100"
                  }`}
                >
                  {m.role === "user" ? (
                    <p className="whitespace-pre-wrap">{m.content}</p>
                  ) : (
                    <StudyChatMessageMarkdown source={m.content} />
                  )}
                </div>
                {m.role === "assistant" && m.options && m.options.length > 0 ? (
                  <ul className="mt-2.5 flex w-full max-w-[92%] flex-col gap-2">
                    {m.options.map((opt) => (
                      <li key={opt.id}>
                        <button
                          type="button"
                          disabled={loading}
                          onClick={() => pickOption(opt)}
                          className="w-full rounded-2xl border border-brand-border/70 bg-white px-3.5 py-2.5 text-left text-xs transition hover:border-brand hover:bg-rose-50/70 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-brand dark:hover:bg-zinc-900/60"
                        >
                          <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                            {opt.label}
                          </span>
                          {opt.description ? (
                            <span className="mt-0.5 block text-[11px] text-zinc-500">
                              {opt.description}
                            </span>
                          ) : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))}
            {loading ? (
              <div className="flex items-center gap-2 text-xs text-brand dark:text-brand-soft">
                <span className="flex gap-1" aria-hidden="true">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand [animation-delay:-0.2s]" />
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand [animation-delay:-0.1s]" />
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" />
                </span>
                <span>{`${AI_ASSISTANT_NAME} is thinking…`}</span>
              </div>
            ) : null}
            {error ? (
              <p className="rounded-2xl border border-red-200 bg-red-50/80 px-3.5 py-2.5 text-sm text-red-600 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
                {error}
              </p>
            ) : null}
            <div ref={bottomRef} />
          </div>

          <div className="shrink-0 border-t border-brand-border/70 bg-white/80 p-3 backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-950/80">
            <div className="flex items-end gap-2">
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
                className="min-h-[44px] flex-1 resize-none rounded-2xl border border-zinc-300 bg-white px-3.5 py-2.5 text-sm text-zinc-900 outline-none ring-brand placeholder:text-zinc-400 focus:border-brand focus:ring-2 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                disabled={loading}
              />
              <button
                type="button"
                disabled={loading || !input.trim()}
                onClick={() => void send()}
                className="shrink-0 rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-rose-900/20 transition hover:bg-brand-hover disabled:opacity-50 dark:hover:bg-brand-soft"
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
