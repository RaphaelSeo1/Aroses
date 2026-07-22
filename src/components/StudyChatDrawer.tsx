"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BrandLogo } from "@/components/BrandLogo";
import { RoseAssistantTabs } from "@/components/RoseAssistantTabs";
import { StudyChatMessageMarkdown } from "@/components/StudyChatMessageMarkdown";
import { AI_ASSISTANT_NAME } from "@/lib/brand";
import {
  loadStudyChatMessages,
  saveStudyChatMessages,
  studyChatStorageKey,
} from "@/lib/study-chat-storage";
import type { StudyChatOption, StudyChatResponse, StudyChatTurn } from "@/types/study-chat";

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
  /** Controlled open state (optional). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Whether the student owns the course (enables the Refine tab). */
  canRefine?: boolean;
  /** Switch to the Refine panel (owner only). */
  onSwitchToRefine?: () => void;
  /** True while a background refine job is writing (shows a dot on the tab). */
  refineBusy?: boolean;
};

const REPLY_ACTION_STEPS = [
  "Reading your question",
  "Searching the lesson",
  "Drafting a reply",
] as const;

const NAV_ACTION_STEPS = [
  "Preparing to navigate",
  "Opening the module",
] as const;

/** True when the student clearly asked to be taken somewhere (not a content Q). */
function looksLikeUserNavigationRequest(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/^module\s*\d+\b/i.test(t)) return true;
  return /\b(take me|bring me|go to|navigate|jump to|open (the )?module|show me (the )?module|switch to)\b/i.test(
    t
  );
}

type ActionTraceKind = "thinking" | "tool" | "draft";

type ActionTraceStep = {
  id: string;
  kind: ActionTraceKind;
  title: string;
  detail: string;
};

type ActionTrace = {
  question: string;
  steps: ActionTraceStep[];
  draftPreview: string;
};

type ChatMessage = StudyChatTurn & {
  options?: StudyChatOption[];
  /** Collapsible work log for this turn (Claude-style). */
  trace?: ActionTrace;
  /** True while the reply is typing out character by character. */
  streaming?: boolean;
};

/** Replies at/over this length are treated as "long" for showing next steps. */
const LONG_REPLY_CHARS = 700;

/**
 * Suggested next steps are noise on a normal single answer. Only surface them
 * when they're actually useful: several distinct options (multiple requests) or
 * a long/complex answer the student may want to branch off from.
 */
function shouldShowOptions(m: ChatMessage): boolean {
  if (m.streaming || !m.options || m.options.length === 0) return false;
  return m.options.length >= 2 || m.content.length >= LONG_REPLY_CHARS;
}

function truncateForTrace(text: string, max = 100): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/** Reveal `full` into `onFrame` in small character chunks. */
function typewriteText(
  full: string,
  onFrame: (partial: string) => void,
  signal?: AbortSignal
): Promise<void> {
  if (!full) {
    onFrame("");
    return Promise.resolve();
  }
  const charsPerTick = Math.max(2, Math.min(8, Math.ceil(full.length / 90)));
  const delayMs = 10;
  return new Promise((resolve, reject) => {
    let i = 0;
    const step = () => {
      if (signal?.aborted) {
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      i = Math.min(full.length, i + charsPerTick);
      onFrame(full.slice(0, i));
      if (i >= full.length) {
        resolve();
        return;
      }
      window.setTimeout(step, delayMs);
    };
    step();
  });
}

function buildReplyTrace(
  question: string,
  moduleId: number,
  stepIndex: number
): ActionTrace {
  const q = truncateForTrace(question || "your question");
  const unlocked = Math.min(stepIndex, 2);
  const steps: ActionTraceStep[] = [
    {
      id: "parse",
      kind: "thinking",
      title: "Understand the ask",
      detail: `Reading: “${q}”`,
    },
  ];
  if (unlocked >= 1) {
    steps.push({
      id: "search",
      kind: "tool",
      title: "Search lesson context",
      detail: `Scanning module ${moduleId} for matching definitions, examples, and related ideas.`,
    });
  }
  if (unlocked >= 2) {
    steps.push({
      id: "draft",
      kind: "draft",
      title: "Draft a reply",
      detail:
        "Composing a clear explanation from the lesson — definitions first, then intuition and connections.",
    });
  }

  const draftBits = [
    `Working from module ${moduleId}…`,
    `Focus: ${q}`,
    unlocked >= 1
      ? "Pulling relevant lesson points and examples into a draft."
      : "Waiting to search the lesson…",
    unlocked >= 2
      ? "Shaping the answer so it’s useful to reread later — not just a transcript of the question."
      : null,
  ].filter(Boolean) as string[];

  return {
    question: q,
    steps,
    draftPreview: draftBits.join("\n\n"),
  };
}

function buildNavTrace(
  question: string,
  stepIndex: number,
  targetLabel?: string
): ActionTrace {
  const q = truncateForTrace(question || "Selected action");
  const unlocked = Math.min(stepIndex, 1);
  const steps: ActionTraceStep[] = [
    {
      id: "plan-nav",
      kind: "thinking",
      title: "Plan navigation",
      detail: `Preparing to open ${targetLabel ?? "the selected module"} from “${q}”.`,
    },
  ];
  if (unlocked >= 1) {
    steps.push({
      id: "open",
      kind: "tool",
      title: "Open module",
      detail: `Navigating to ${targetLabel ?? "the module"} now.`,
    });
  }
  return {
    question: q,
    steps,
    draftPreview: `Switching the lesson view to ${targetLabel ?? "the selected module"}…`,
  };
}

function ActionSpinner({ className }: { className?: string }) {
  return (
    <svg
      className={`animate-spin ${className ?? "h-4 w-4"}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle
        className="opacity-20"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
      />
      <path
        className="opacity-90"
        d="M22 12a10 10 0 0 1-10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function TraceKindIcon({ kind }: { kind: ActionTraceKind }) {
  if (kind === "tool") {
    return (
      <svg
        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand dark:text-brand-soft"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
      </svg>
    );
  }
  if (kind === "draft") {
    return (
      <svg
        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-500"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
    );
  }
  return (
    <svg
      className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-500"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4l2.5 1.5" />
    </svg>
  );
}

function ActionDetailsPanel({
  trace,
  live,
  activeStepIndex,
}: {
  trace: ActionTrace;
  live?: boolean;
  activeStepIndex?: number;
}) {
  return (
    <div className="mt-2 space-y-3 border-t border-brand-border/60 pt-2.5 dark:border-brand/25">
      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
          Thinking
        </p>
        <ul className="space-y-2">
          {trace.steps.map((step, i) => {
            const active =
              live &&
              typeof activeStepIndex === "number" &&
              i === Math.min(activeStepIndex, trace.steps.length - 1);
            const done =
              !live ||
              (typeof activeStepIndex === "number" && i < activeStepIndex);
            return (
              <li key={step.id} className="flex items-start gap-2">
                <TraceKindIcon kind={step.kind} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p
                      className={`text-[12px] font-medium ${
                        active
                          ? "text-brand dark:text-brand-soft"
                          : "text-zinc-800 dark:text-zinc-200"
                      }`}
                    >
                      {step.title}
                    </p>
                    {active ? (
                      <ActionSpinner className="h-3 w-3 text-brand" />
                    ) : done ? (
                      <svg
                        className="h-3 w-3 text-emerald-600 dark:text-emerald-400"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden
                      >
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
                    {step.detail}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
      {trace.draftPreview ? (
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
            {live ? "Drafting" : "Draft notes"}
          </p>
          <div className="rounded-lg border border-zinc-200/80 bg-white/70 px-3 py-2.5 dark:border-zinc-700 dark:bg-zinc-950/60">
            <p className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-400">
              {trace.draftPreview}
              {live ? (
                <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-brand/70 align-middle" />
              ) : null}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ActionProgressCard({
  stepIndex,
  total,
  label,
  trace,
  detailsOpen,
  onDetailsOpenChange,
}: {
  stepIndex: number;
  total: number;
  label: string;
  trace: ActionTrace;
  detailsOpen: boolean;
  onDetailsOpenChange: (open: boolean) => void;
}) {
  const current = Math.min(stepIndex + 1, total);
  return (
    <div
      className="w-full max-w-[92%] rounded-xl border border-brand-border/80 bg-brand-blush/50 px-3.5 py-3 dark:border-brand/30 dark:bg-[#1e1616]/45"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-brand dark:text-brand-soft">
          <ActionSpinner />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-brand dark:text-brand-soft">
            Action {current} of {total}
          </p>
          <p className="mt-0.5 text-[13px] leading-snug text-zinc-700 dark:text-zinc-300">
            {label}
          </p>
          <button
            type="button"
            onClick={() => onDetailsOpenChange(!detailsOpen)}
            aria-expanded={detailsOpen}
            className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-brand transition hover:text-brand-hover dark:text-brand-soft"
          >
            {detailsOpen ? "Hide details" : "Show details"}
            <svg
              className={`h-3 w-3 transition ${detailsOpen ? "rotate-180" : ""}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              aria-hidden
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
          {detailsOpen ? (
            <ActionDetailsPanel
              trace={trace}
              live
              activeStepIndex={stepIndex}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function CompletedTraceToggle({ trace }: { trace: ActionTrace }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1.5 w-full max-w-[92%]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 text-[11px] font-medium text-zinc-500 transition hover:text-brand dark:text-zinc-400 dark:hover:text-brand-soft"
      >
        <span className="tabular-nums">{trace.steps.length} steps</span>
        <span aria-hidden>·</span>
        {open ? "Hide details" : "Show details"}
        <svg
          className={`h-3 w-3 transition ${open ? "rotate-180" : ""}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          aria-hidden
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open ? (
        <div className="mt-1.5 rounded-xl border border-zinc-200 bg-zinc-50/80 px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-900/50">
          <ActionDetailsPanel trace={trace} />
        </div>
      ) : null}
    </div>
  );
}

export function StudyChatDrawer({
  materialId,
  moduleId,
  quizOpen,
  courseId,
  studyHrefBase,
  learnMode = false,
  docked = false,
  variant = "course",
  open: openProp,
  onOpenChange,
  canRefine = false,
  onSwitchToRefine,
  refineBusy = false,
}: Props) {
  const router = useRouter();
  const storageKey = studyChatStorageKey(courseId, materialId);
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : uncontrolledOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      if (!isControlled) setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange]
  );
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // Which storage key the current `messages` state was loaded from. Guards the
  // save effect below: when the user switches lecture materials the key changes
  // one render before the new thread is loaded, and saving in that window would
  // copy the previous material's messages into the new material's storage.
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionMode, setActionMode] = useState<"idle" | "replying" | "navigating">(
    "idle"
  );
  const [actionStep, setActionStep] = useState(0);
  const [actionDetailsOpen, setActionDetailsOpen] = useState(false);
  const [actionQuestion, setActionQuestion] = useState("");
  const [actionNavLabel, setActionNavLabel] = useState<string | undefined>();
  const bottomRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const navTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typewriteAbortRef = useRef<AbortController | null>(null);

  const actionSteps =
    actionMode === "navigating" ? NAV_ACTION_STEPS : REPLY_ACTION_STEPS;
  const showActionProgress = actionMode !== "idle";
  const isStreamingReply = messages.some((m) => m.streaming);
  const liveTrace =
    actionMode === "navigating"
      ? buildNavTrace(actionQuestion, actionStep, actionNavLabel)
      : buildReplyTrace(actionQuestion, moduleId, actionStep);

  useEffect(() => {
    return () => {
      typewriteAbortRef.current?.abort();
      if (navTimerRef.current) clearTimeout(navTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (actionMode === "idle") return;
    setActionStep(0);
    const max = actionSteps.length - 1;
    const id = window.setInterval(() => {
      setActionStep((s) => Math.min(s + 1, max));
    }, 1200);
    return () => window.clearInterval(id);
  }, [actionMode, actionSteps.length]);

  useEffect(() => {
    setMessages(loadStudyChatMessages(storageKey));
    setLoadedKey(storageKey);
  }, [storageKey]);

  useEffect(() => {
    if (loadedKey !== storageKey) return;
    saveStudyChatMessages(storageKey, messages);
  }, [loadedKey, messages, storageKey]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open, loading, actionMode, actionStep]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

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
  }, [materialId, moduleId, setOpen]);

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
    [learnMode, router, setOpen, studyHrefBase, variant]
  );

  const scheduleNavigate = useCallback(
    (targetMaterial: string, targetModule: number, label?: string) => {
      if (navTimerRef.current) clearTimeout(navTimerRef.current);
      setActionNavLabel(label ?? `module ${targetModule}`);
      setActionMode("navigating");
      setActionStep(0);
      navTimerRef.current = setTimeout(() => {
        navigateTo(targetMaterial, targetModule);
        setActionMode("idle");
        navTimerRef.current = null;
      }, 900);
    },
    [navigateTo]
  );

  const send = useCallback(async (textOverride?: string) => {
    const text = (textOverride ?? input).trim();
    if (!text || loading || actionMode === "navigating" || isStreamingReply) {
      return;
    }

    const prevSnapshot = messages;
    const nextMessages: ChatMessage[] = [
      ...prevSnapshot,
      { role: "user", content: text },
    ];

    setError(null);
    setMessages(nextMessages);
    if (!textOverride) setInput("");
    setLoading(true);
    setActionQuestion(text);
    setActionMode("replying");
    setActionStep(0);

    let willNavigate = false;

    try {
      const res = await fetch("/api/study-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          materialId,
          moduleId,
          quizOpen,
          messages: nextMessages.map(({ role, content }) => ({ role, content })),
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

      const completedTrace = buildReplyTrace(text, moduleId, 2);
      completedTrace.draftPreview = truncateForTrace(reply, 280);

      // Stop the action spinner and type the reply out character by character.
      setLoading(false);
      setActionMode("idle");
      typewriteAbortRef.current?.abort();
      const ac = new AbortController();
      typewriteAbortRef.current = ac;

      setMessages([
        ...nextMessages,
        { role: "assistant", content: "", streaming: true },
      ]);

      try {
        await typewriteText(
          reply,
          (partial) => {
            setMessages((prev) => {
              const copy = [...prev];
              const last = copy[copy.length - 1];
              if (last?.role === "assistant") {
                copy[copy.length - 1] = {
                  ...last,
                  content: partial,
                  streaming: true,
                };
              }
              return copy;
            });
          },
          ac.signal
        );
      } catch {
        if (ac.signal.aborted) return;
      }

      if (ac.signal.aborted) return;

      setMessages([
        ...nextMessages,
        {
          role: "assistant",
          content: reply,
          options,
          trace: completedTrace,
          streaming: false,
        },
      ]);

      // Only auto-navigate when the student explicitly asked to go somewhere.
      // Model "action" after a normal Q&A is a suggestion — they must tap an option.
      const action = payload.action ?? null;
      const userAskedToNavigate = looksLikeUserNavigationRequest(text);
      if (
        userAskedToNavigate &&
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
          willNavigate = true;
          setActionQuestion(text);
          scheduleNavigate(
            targetMaterial,
            targetModule,
            `module ${targetModule}`
          );
        }
      }
    } catch {
      setError("Network error.");
      setMessages(prevSnapshot);
      if (!textOverride) setInput(text);
    } finally {
      setLoading(false);
      if (!willNavigate) setActionMode("idle");
    }
  }, [
    actionMode,
    input,
    isStreamingReply,
    loading,
    materialId,
    moduleId,
    quizOpen,
    messages,
    scheduleNavigate,
  ]);

  const pickOption = useCallback(
    (option: StudyChatOption) => {
      if (option.action.type === "navigate_to_location") {
        setMessages((prev) => [
          ...prev,
          {
            role: "user",
            content: option.label,
          },
        ]);
        setActionQuestion(option.label);
        scheduleNavigate(
          option.action.materialId,
          option.action.moduleId,
          option.label
        );
        return;
      }
      void send(option.label);
    },
    [scheduleNavigate, send]
  );

  const subtitle =
    variant === "legacy"
      ? "Uses your summary and practice questions only."
      : quizOpen
        ? "Quiz mode — guides reasoning without revealing answers."
        : "Context-aware help for this lesson.";

  return (
    <>
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={
            docked
              ? "inline-flex min-w-[10.5rem] items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-900 shadow-sm transition hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900"
              : "fixed bottom-6 right-6 z-[100] inline-flex min-w-[10.5rem] items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-900 shadow-md transition hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900"
          }
        >
          <BrandLogo className="h-5 w-5 rounded-md" />
          <span>
            Ask{" "}
            <span className="text-brand dark:text-brand-soft">
              {AI_ASSISTANT_NAME}
            </span>
          </span>
        </button>
      ) : null}

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="false"
        aria-hidden={!open}
        aria-label={`${AI_ASSISTANT_NAME} study chat`}
        className={`fixed top-14 right-0 z-[100] flex h-[calc(100vh-3.5rem)] w-[min(100vw-12px,24rem)] flex-col border-l border-zinc-200 bg-white transition-[transform,opacity] duration-300 ease-out dark:border-zinc-800 dark:bg-zinc-950 sm:top-16 sm:h-[calc(100vh-4rem)] sm:w-[min(100vw-16px,28rem)] ${
          open
            ? "translate-x-0 opacity-100"
            : "pointer-events-none translate-x-full opacity-0"
        }`}
        style={{
          boxShadow: open
            ? "-8px 0 32px -16px rgba(0,0,0,0.14)"
            : "none",
        }}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <BrandLogo className="h-8 w-8 rounded-lg" />
              <div className="min-w-0">
                <p className="text-sm font-semibold tracking-tight text-brand dark:text-brand-soft">
                  {AI_ASSISTANT_NAME}
                </p>
                <p className="truncate text-[12px] text-zinc-500 dark:text-zinc-400">
                  {subtitle}
                </p>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
          >
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {variant === "course" ? (
          <RoseAssistantTabs
            active="ask"
            canRefine={canRefine}
            onSelectAsk={() => {}}
            onSelectRefine={() => onSwitchToRefine?.()}
            refineBusy={refineBusy}
          />
        ) : null}

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-6">
          {messages.length === 0 ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <BrandLogo className="h-5 w-5 rounded-md" />
                <span className="text-[12px] font-semibold text-brand dark:text-brand-soft">
                  {AI_ASSISTANT_NAME}
                </span>
              </div>
              <p className="text-[13.5px] leading-relaxed text-zinc-700 dark:text-zinc-300">
                {`Hi — I'm ${AI_ASSISTANT_NAME}. Ask me anything about this lesson and I'll explain it clearly: definitions, the intuition behind an idea, worked examples, or how concepts connect.`}
              </p>
            </div>
          ) : null}
          {messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl bg-zinc-100 px-4 py-2.5 text-[13px] leading-relaxed text-zinc-900 dark:bg-zinc-800/70 dark:text-zinc-100">
                  <p className="whitespace-pre-wrap">{m.content}</p>
                </div>
              </div>
            ) : (
              <div key={i} className="flex flex-col gap-2.5">
                <div className="flex items-center gap-2">
                  <BrandLogo className="h-5 w-5 rounded-md" />
                  <span className="text-[12px] font-semibold text-brand dark:text-brand-soft">
                    {AI_ASSISTANT_NAME}
                  </span>
                </div>
                <div className="text-[13.5px] leading-relaxed text-zinc-800 dark:text-zinc-200">
                  {m.streaming ? (
                    <p className="whitespace-pre-wrap">
                      {m.content}
                      <span
                        className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-brand/70 align-middle"
                        aria-hidden
                      />
                    </p>
                  ) : (
                    <StudyChatMessageMarkdown source={m.content} />
                  )}
                </div>
                {!m.streaming && m.trace ? (
                  <CompletedTraceToggle trace={m.trace} />
                ) : null}
                {shouldShowOptions(m) ? (
                  <div className="mt-1 space-y-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-brand dark:text-brand-soft">
                      Suggested next steps
                    </p>
                    <ul className="flex flex-col gap-1.5">
                      {m.options?.map((opt) => (
                        <li key={opt.id}>
                          <button
                            type="button"
                            disabled={
                              loading || showActionProgress || isStreamingReply
                            }
                            onClick={() => pickOption(opt)}
                            className="flex w-full items-start gap-2.5 rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-left text-[12px] transition hover:border-brand-border hover:bg-brand-blush/40 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:border-brand/40 dark:hover:bg-[#1e1616]/40"
                          >
                            <svg
                              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand dark:text-brand-soft"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              aria-hidden
                            >
                              <path d="M5 12h14M13 6l6 6-6 6" />
                            </svg>
                            <span className="min-w-0">
                              <span className="font-medium text-zinc-900 dark:text-zinc-100">
                                {opt.label}
                              </span>
                              {opt.description ? (
                                <span className="mt-0.5 block text-[11px] text-zinc-500">
                                  {opt.description}
                                </span>
                              ) : null}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            )
          )}
          {showActionProgress ? (
            <ActionProgressCard
              stepIndex={actionStep}
              total={actionSteps.length}
              label={actionSteps[Math.min(actionStep, actionSteps.length - 1)]!}
              trace={liveTrace}
              detailsOpen={actionDetailsOpen}
              onDetailsOpenChange={setActionDetailsOpen}
            />
          ) : null}
          {error ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </p>
          ) : null}
          <div ref={bottomRef} />
        </div>

        <div className="shrink-0 border-t border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="rounded-xl border border-zinc-200 bg-zinc-50/50 focus-within:border-brand-border focus-within:bg-white dark:border-zinc-800 dark:bg-zinc-900/40 dark:focus-within:border-brand/40 dark:focus-within:bg-zinc-950">
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
              placeholder={`Message ${AI_ASSISTANT_NAME}…`}
              className="min-h-[52px] w-full resize-none bg-transparent px-3.5 pt-3 text-[13px] text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
              disabled={loading || showActionProgress || isStreamingReply}
              tabIndex={open ? 0 : -1}
            />
            <div className="flex items-center justify-between gap-2 px-2.5 pb-2.5">
              <p className="px-1 text-[10px] text-zinc-400">
                Enter to send · Shift+Enter for new line
              </p>
              <button
                type="button"
                disabled={
                  loading ||
                  showActionProgress ||
                  isStreamingReply ||
                  !input.trim()
                }
                onClick={() => void send()}
                tabIndex={open ? 0 : -1}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3.5 text-[12px] font-semibold text-white transition hover:bg-brand-hover disabled:opacity-40"
              >
                {showActionProgress || isStreamingReply ? (
                  <ActionSpinner className="h-3.5 w-3.5" />
                ) : null}
                Send
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
