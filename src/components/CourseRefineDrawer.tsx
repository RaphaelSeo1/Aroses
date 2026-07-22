"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BrandLogo } from "@/components/BrandLogo";
import { RoseAssistantTabs } from "@/components/RoseAssistantTabs";
import type { RefinePlan } from "@/lib/ai/refine-course-planner";
import { AI_ASSISTANT_NAME } from "@/lib/brand";
import {
  AROSES_COURSE_REFINED_EVENT,
  AROSES_COURSE_REFINE_PREVIEW_EVENT,
  type ArosesCourseRefinedDetail,
  type ArosesCourseRefinePreviewDetail,
} from "@/lib/refine-course-events";
import {
  AROSES_COURSE_REFINE_APPLY_CANCELLED_EVENT,
  AROSES_COURSE_REFINE_APPLY_PROGRESS_EVENT,
  isRefineApplyJobRunning,
  startRefineApplyJob,
  stopRefineApplyJob,
  type ArosesCourseRefineApplyCancelledDetail,
  type ArosesCourseRefineApplyProgressDetail,
} from "@/lib/refine-course-client-job";

type Phase = "idle" | "planning" | "confirm" | "applying";

type Props = {
  materialId: string;
  /** Prefer editing this module first so the open lesson updates immediately. */
  preferModuleId?: number;
  docked?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Switch back to the Ask panel. */
  onSwitchToAsk?: () => void;
  /** When false, the collapsed launcher button is hidden (opened via tab only). */
  showLauncher?: boolean;
};

/**
 * Reveals `text` one character at a time. `delayMs` staggers the start so the
 * plan card's summary, bullets, and scope type in sequence — matching the
 * self-study confirm step. `speed` is the per-character delay in ms.
 */
function Typewriter({
  text,
  delayMs = 0,
  speed = 16,
}: {
  text: string;
  delayMs?: number;
  speed?: number;
}) {
  const [shown, setShown] = useState(0);
  const [started, setStarted] = useState(delayMs === 0);

  useEffect(() => {
    setShown(0);
    if (delayMs <= 0) {
      setStarted(true);
      return;
    }
    setStarted(false);
    const t = setTimeout(() => setStarted(true), delayMs);
    return () => clearTimeout(t);
  }, [text, delayMs]);

  useEffect(() => {
    if (!started || shown >= text.length) return;
    const t = setTimeout(() => setShown((n) => n + 1), speed);
    return () => clearTimeout(t);
  }, [shown, text, started, speed]);

  return (
    <>
      {text.slice(0, shown)}
      {started && shown < text.length ? (
        <span className="ml-px inline-block h-[1em] w-[1px] animate-pulse bg-current align-baseline" />
      ) : null}
    </>
  );
}

/** Strip planner prefixes like "Edit:" / "Add:" so bullets read cleanly. */
function cleanChangeLine(change: string): string {
  return change.replace(/^\s*(edit|change|update|action)\s*:\s*/i, "").trim();
}

/** Human-readable scope for the "Where" line of the plan card. */
function scopeLine(plan: RefinePlan): string {
  if (plan.strategy === "metadata") return "Course title and description";
  const ids = plan.targetModuleIds;
  if (!ids.length) return "Across the whole course";
  if (ids.length === 1) return `Module ${ids[0]} only`;
  return `Modules ${ids.join(", ")}`;
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

export function CourseRefineDrawer({
  materialId,
  preferModuleId,
  docked = false,
  open: openProp,
  onOpenChange,
  onSwitchToAsk,
  showLauncher = true,
}: Props) {
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
  const [instruction, setInstruction] = useState("");
  /**
   * Locked original request once a plan exists. Clarifications answer the plan
   * without replacing this — e.g. original "make module X longer" + "only lesson 2".
   */
  const [baseInstruction, setBaseInstruction] = useState<string | null>(null);
  const [clarifications, setClarifications] = useState<string[]>([]);
  /** Fresh empty box on the confirm step for answering / narrowing the plan. */
  const [clarifyDraft, setClarifyDraft] = useState("");
  const [phase, setPhase] = useState<Phase>(() =>
    isRefineApplyJobRunning(materialId) ? "applying" : "idle"
  );
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<RefinePlan | null>(null);
  const [phaseMessage, setPhaseMessage] = useState<string | null>(null);
  const [thinkingLines, setThinkingLines] = useState<string[]>([]);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [actionIndex, setActionIndex] = useState(0);
  const [actionTotal, setActionTotal] = useState(0);
  const [actionLabel, setActionLabel] = useState("Working…");
  const panelRef = useRef<HTMLDivElement>(null);
  const planAbortRef = useRef<AbortController | null>(null);

  const busy = phase === "planning" || phase === "applying";

  /** Full instruction the planner/applier sees: original + stacked clarifications. */
  const composeInstruction = useCallback(
    (base: string, notes: string[]) => {
      const b = base.trim();
      if (notes.length === 0) return b;
      return `${b}

CLARIFICATIONS FROM THE STUDENT (these refine the request above — they do NOT replace it. Apply them as scope/detail on top of the original):
${notes.map((n, i) => `${i + 1}. ${n.trim()}`).join("\n")}`;
    },
    []
  );

  const fullInstruction = useMemo(() => {
    if (baseInstruction) return composeInstruction(baseInstruction, clarifications);
    return instruction.trim();
  }, [baseInstruction, clarifications, composeInstruction, instruction]);

  /**
   * Show (or clear) the pre-confirm preview: a caret hovering over the exact
   * spans in the course document that the edit will change. Empty clears it.
   */
  const emitPreview = useCallback(
    (edits: ArosesCourseRefinePreviewDetail["edits"]) => {
      window.dispatchEvent(
        new CustomEvent(AROSES_COURSE_REFINE_PREVIEW_EVENT, {
          detail: { materialId, edits } satisfies ArosesCourseRefinePreviewDetail,
        })
      );
    },
    [materialId]
  );

  /** Character-by-character reveal schedule for the confirm plan card. */
  const planReveal = useMemo(() => {
    if (!plan) return null;
    const speed = 14;
    const summary = plan.summary;
    const bullets = plan.proposedChanges.map(cleanChangeLine);
    const where = scopeLine(plan);
    const summaryDelay = 120;
    let cursor = summaryDelay + summary.length * speed + 140;
    const bulletDelays = bullets.map((b) => {
      const d = cursor;
      cursor += b.length * speed + 90;
      return d;
    });
    const whereDelay = cursor + 80;
    return { speed, summary, bullets, where, summaryDelay, bulletDelays, whereDelay };
  }, [plan]);

  const resetToIdle = useCallback(
    (clearInstruction = false) => {
      setPhase("idle");
      setPlan(null);
      setPhaseMessage(null);
      setThinkingLines([]);
      setActionIndex(0);
      setActionTotal(0);
      setDetailsOpen(false);
      setError(null);
      emitPreview([]);
      setClarifyDraft("");
      if (clearInstruction) {
        setInstruction("");
        setBaseInstruction(null);
        setClarifications([]);
      }
    },
    [emitPreview]
  );

  /** Hide the panel only — never cancels planning or applying. */
  const closeDrawer = useCallback(() => {
    setOpen(false);
  }, [setOpen]);

  const stopEdits = useCallback(() => {
    stopRefineApplyJob(materialId);
    setPhase("confirm");
    setPhaseMessage("Edits stopped.");
    setActionLabel("Stopped");
    setError(null);
  }, [materialId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDrawer();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closeDrawer]);

  useEffect(() => {
    if (!open || phase !== "confirm") return;
    const t = window.setTimeout(() => {
      panelRef.current
        ?.querySelector<HTMLElement>("textarea[data-refine-clarify]")
        ?.focus();
    }, 100);
    return () => window.clearTimeout(t);
  }, [open, phase]);

  useEffect(() => {
    if (!open || phase !== "idle") return;
    const t = window.setTimeout(() => {
      panelRef.current
        ?.querySelector<HTMLElement>("textarea[data-refine-main]")
        ?.focus();
    }, 100);
    return () => window.clearTimeout(t);
  }, [open, phase]);

  useEffect(() => {
    function onProgress(ev: Event) {
      const d = (ev as CustomEvent<ArosesCourseRefineApplyProgressDetail>)
        .detail;
      if (!d || d.materialId !== materialId) return;
      if (typeof d.phaseMessage === "string") setPhaseMessage(d.phaseMessage);
      if (typeof d.thinking === "string") {
        setThinkingLines((prev) => [...prev, d.thinking!]);
      }
      if (typeof d.actionIndex === "number") setActionIndex(d.actionIndex);
      if (typeof d.actionTotal === "number") setActionTotal(d.actionTotal);
      if (typeof d.actionLabel === "string") setActionLabel(d.actionLabel);
    }

    function onRefined(ev: Event) {
      const d = (ev as CustomEvent<ArosesCourseRefinedDetail>).detail;
      if (!d || d.materialId !== materialId) return;
      resetToIdle(true);
    }

    function onCancelled(ev: Event) {
      const d = (ev as CustomEvent<ArosesCourseRefineApplyCancelledDetail>)
        .detail;
      if (!d || d.materialId !== materialId) return;
      if (d.reason === "stopped") {
        setPhase((prev) => (prev === "applying" ? "confirm" : prev));
        setPhaseMessage("Edits stopped.");
        setActionLabel("Stopped");
        return;
      }
      setError(d.message ?? "Could not apply edits.");
      setPhase("confirm");
      setOpen(true);
    }

    window.addEventListener(AROSES_COURSE_REFINE_APPLY_PROGRESS_EVENT, onProgress);
    window.addEventListener(AROSES_COURSE_REFINED_EVENT, onRefined);
    window.addEventListener(
      AROSES_COURSE_REFINE_APPLY_CANCELLED_EVENT,
      onCancelled
    );
    return () => {
      window.removeEventListener(
        AROSES_COURSE_REFINE_APPLY_PROGRESS_EVENT,
        onProgress
      );
      window.removeEventListener(AROSES_COURSE_REFINED_EVENT, onRefined);
      window.removeEventListener(
        AROSES_COURSE_REFINE_APPLY_CANCELLED_EVENT,
        onCancelled
      );
    };
  }, [materialId, resetToIdle, setOpen]);

  const requestPlan = useCallback(
    async (opts?: { clarification?: string }) => {
      const clarification = opts?.clarification?.trim() ?? "";
      const nextNotes =
        clarification.length > 0
          ? [...clarifications, clarification]
          : clarifications;
      const base =
        (baseInstruction ?? instruction).trim() || instruction.trim();
      if (base.length < 8 || busy) return;

      const text = composeInstruction(base, nextNotes);
      if (text.length < 8) return;

      setError(null);
      setPhase("planning");
      setPlan(null);
      emitPreview([]);
      setClarifyDraft("");
      // Lock the original on first plan; stack clarifications on re-plan.
      if (!baseInstruction) setBaseInstruction(base);
      if (clarification.length > 0) setClarifications(nextNotes);
      setInstruction(base);
      setThinkingLines([
        "Reading your edit request…",
        clarification
          ? `Applying your clarification: “${clarification}”…`
          : "Matching it against the course outline…",
      ]);
      setPhaseMessage("Thinking about how to edit…");
      setActionIndex(1);
      setActionTotal(2);
      setActionLabel("Planning edits…");

      planAbortRef.current?.abort();
      const ac = new AbortController();
      planAbortRef.current = ac;

      try {
        const res = await fetch("/api/refine-course", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            materialId,
            instruction: text,
            mode: "plan",
            preferModuleId,
          }),
          signal: ac.signal,
        });
        if (ac.signal.aborted) return;
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(
            typeof body.error === "string"
              ? body.error
              : "Could not plan edits."
          );
          setPhase(baseInstruction || clarification ? "confirm" : "idle");
          return;
        }
        const nextPlan = body.plan as RefinePlan | undefined;
        if (!nextPlan || !Array.isArray(nextPlan.proposedChanges)) {
          setError("Could not understand that edit request.");
          setPhase(baseInstruction || clarification ? "confirm" : "idle");
          return;
        }
        setPlan(nextPlan);
        setThinkingLines((prev) => [
          ...prev,
          nextPlan.summary,
          `Will apply: ${nextPlan.editInstruction}`,
        ]);
        setPhaseMessage(nextPlan.summary);
        setPhase("confirm");
        setActionIndex(2);
        setActionTotal(2);
        setActionLabel("Ready for your confirmation");
        emitPreview(nextPlan.previewEdits ?? []);
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError("Network error.");
        setPhase(baseInstruction || clarification ? "confirm" : "idle");
      } finally {
        if (planAbortRef.current === ac) planAbortRef.current = null;
      }
    },
    [
      busy,
      instruction,
      baseInstruction,
      clarifications,
      composeInstruction,
      materialId,
      preferModuleId,
      emitPreview,
    ]
  );

  const applyConfirmed = useCallback(() => {
    const text = fullInstruction.trim();
    if (!plan || text.length < 8 || busy) return;

    setError(null);
    setPhase("applying");
    setPhaseMessage("Writing your edits…");
    setActionIndex(1);
    setActionTotal(Math.max(1, plan.proposedChanges.length));
    setActionLabel("Writing…");
    setThinkingLines((prev) => [
      ...prev,
      "Confirmed — writing continues even if you close this panel.",
    ]);

    emitPreview([]);

    startRefineApplyJob({
      materialId,
      instruction: text,
      plan,
      preferModuleId,
    });
    // Fresh slate when they reopen — original + clarifications already went
    // into the apply job.
    setInstruction("");
    setBaseInstruction(null);
    setClarifications([]);
    setClarifyDraft("");
    setOpen(false);
  }, [
    busy,
    fullInstruction,
    materialId,
    plan,
    preferModuleId,
    setOpen,
    emitPreview,
  ]);

  return (
    <>
      {!open && showLauncher ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={
            docked
              ? "inline-flex min-w-[10.5rem] items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-900 shadow-sm transition hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900"
              : "fixed bottom-28 right-6 z-[100] inline-flex min-w-[10.5rem] items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-900 shadow-md transition hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900"
          }
        >
          <BrandLogo className="h-5 w-5 rounded-md" />
          <span>
            {phase === "applying" ? (
              <>
                <span className="text-brand dark:text-brand-soft">Editing…</span>
                {" · Open"}
              </>
            ) : (
              <>
                Refine with{" "}
                <span className="text-brand dark:text-brand-soft">
                  {AI_ASSISTANT_NAME}
                </span>
              </>
            )}
          </span>
        </button>
      ) : null}

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="false"
        aria-hidden={!open}
        aria-label={`Refine course with ${AI_ASSISTANT_NAME}`}
        className={`fixed top-14 right-0 z-[100] flex h-[calc(100vh-3.5rem)] w-[min(100vw-12px,24rem)] flex-col border-l border-zinc-200 bg-white transition-[transform,opacity] duration-300 ease-out dark:border-zinc-800 dark:bg-zinc-950 sm:top-16 sm:h-[calc(100vh-4rem)] sm:w-[min(100vw-16px,28rem)] ${
          open
            ? "translate-x-0 opacity-100"
            : "pointer-events-none translate-x-full opacity-0"
        }`}
        style={{
          boxShadow: open ? "-8px 0 32px -16px rgba(0,0,0,0.14)" : "none",
        }}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <div className="flex min-w-0 items-center gap-2.5">
            <BrandLogo className="h-8 w-8 rounded-lg" />
            <div className="min-w-0">
              <p className="text-sm font-semibold tracking-tight text-brand dark:text-brand-soft">
                Refine with {AI_ASSISTANT_NAME}
              </p>
              <p className="truncate text-[12px] text-zinc-500 dark:text-zinc-400">
                {phase === "applying"
                  ? "Writing in the background — close anytime"
                  : "Plan first — then confirm before anything is rewritten."}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={closeDrawer}
            aria-label="Close panel"
            title="Close panel (edits keep running)"
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

        <RoseAssistantTabs
          active="refine"
          canRefine
          onSelectAsk={() => onSwitchToAsk?.()}
          onSelectRefine={() => {}}
          refineBusy={phase === "applying"}
        />

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">
          {phase === "idle" ? (
            <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
              Describe the change in plain language. Rose will propose a plan
              for you to confirm before rewriting anything.
            </p>
          ) : null}

          {phase === "confirm" && plan && planReveal ? (
            <div className="space-y-4">
              {(baseInstruction || clarifications.length > 0) && (
                <div className="rounded-xl border border-zinc-200 bg-zinc-50/80 px-3.5 py-3 dark:border-zinc-800 dark:bg-zinc-900/40">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                    Your request
                  </p>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-800 dark:text-zinc-200">
                    {baseInstruction ?? instruction}
                  </p>
                  {clarifications.length > 0 ? (
                    <ul className="mt-2 space-y-1 border-t border-zinc-200/80 pt-2 dark:border-zinc-800">
                      {clarifications.map((c, i) => (
                        <li
                          key={`${i}-${c.slice(0, 20)}`}
                          className="text-[12px] leading-relaxed text-zinc-600 dark:text-zinc-400"
                        >
                          <span className="font-semibold text-brand dark:text-brand-soft">
                            Clarified:
                          </span>{" "}
                          {c}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              )}

              <div className="rounded-2xl border border-brand-border/70 bg-brand-blush/40 px-4 py-4 dark:border-brand/30 dark:bg-[#1e1616]/40">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-brand dark:text-brand-soft">
                  Here&apos;s the plan
                </p>

                <p className="mt-3 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
                  <Typewriter
                    text={planReveal.summary}
                    delayMs={planReveal.summaryDelay}
                    speed={planReveal.speed}
                  />
                </p>

                <p className="mt-4 text-[11px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-500">
                  What {AI_ASSISTANT_NAME} will change
                </p>
                <ul className="mt-2 space-y-1.5 text-sm text-zinc-800 dark:text-zinc-100">
                  {planReveal.bullets.map((change, i) => (
                    <li
                      key={`${i}-${change.slice(0, 24)}`}
                      className="flex items-start gap-2 leading-relaxed"
                    >
                      <span className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
                      <span>
                        <Typewriter
                          text={change}
                          delayMs={planReveal.bulletDelays[i]}
                          speed={planReveal.speed}
                        />
                      </span>
                    </li>
                  ))}
                </ul>

                <p className="mt-4 text-[11px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-500">
                  Where
                </p>
                <p className="mt-1 text-sm italic leading-relaxed text-zinc-700 dark:text-zinc-300">
                  <Typewriter
                    text={planReveal.where}
                    delayMs={planReveal.whereDelay}
                    speed={planReveal.speed}
                  />
                </p>
              </div>

              <button
                type="button"
                onClick={() => setDetailsOpen((v) => !v)}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-zinc-500 transition hover:text-brand dark:text-zinc-400"
              >
                {detailsOpen ? "Hide technical details" : "Show technical details"}
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
                <div className="rounded-lg border border-zinc-200 bg-zinc-50/80 px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-900/50">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                    How it will run
                  </p>
                  <p className="mt-1 text-[12px] leading-relaxed text-zinc-600 dark:text-zinc-400">
                    {plan.editInstruction}
                  </p>
                  <p className="mt-2 text-[11px] text-zinc-500">
                    Strategy: {plan.strategy}
                    {plan.targetModuleIds.length
                      ? ` · modules ${plan.targetModuleIds.join(", ")}`
                      : " · all modules"}
                    {plan.bulkOps.length
                      ? ` · bulk: ${plan.bulkOps.join(", ")}`
                      : ""}
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}

          {(phase === "planning" || phase === "applying") && (
            <div className="rounded-xl border border-brand-border/80 bg-brand-blush/50 px-3.5 py-3 dark:border-brand/30 dark:bg-[#1e1616]/45">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-2.5">
                  <span className="mt-0.5 text-brand dark:text-brand-soft">
                    <ActionSpinner />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-zinc-900 dark:text-zinc-50">
                      {phase === "planning" ? "Thinking…" : actionLabel}
                    </p>
                    <p className="mt-0.5 text-[12px] text-zinc-600 dark:text-zinc-400">
                      {phaseMessage}
                    </p>
                    {phase === "applying" ? (
                      <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-500">
                        Closing this panel does not stop writing.
                      </p>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setDetailsOpen((v) => !v)}
                      className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-brand dark:text-brand-soft"
                    >
                      {detailsOpen ? "Hide details" : "Show details"}
                      <svg
                        className={`h-3 w-3 transition ${detailsOpen ? "rotate-180" : ""}`}
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        aria-hidden
                      >
                        <path d="M6 9l6 6 6-6" />
                      </svg>
                    </button>
                  </div>
                </div>
                <p className="shrink-0 text-[11px] font-semibold tabular-nums text-brand dark:text-brand-soft">
                  {Math.max(1, actionIndex)} of {Math.max(1, actionTotal)}{" "}
                  actions
                </p>
              </div>
              {detailsOpen ? (
                <div className="mt-3 space-y-1.5 border-t border-brand-border/50 pt-2.5 dark:border-brand/25">
                  {thinkingLines.slice(-8).map((line, i) => (
                    <p
                      key={`${i}-${line.slice(0, 24)}`}
                      className="font-mono text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-400"
                    >
                      {line}
                    </p>
                  ))}
                </div>
              ) : null}
            </div>
          )}

          {error ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </p>
          ) : null}
        </div>

        <div className="shrink-0 space-y-3 border-t border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
          {phase === "confirm" && plan ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => applyConfirmed()}
                className="flex-1 rounded-xl bg-brand py-2.5 text-sm font-semibold text-white transition hover:bg-brand-hover disabled:opacity-50"
              >
                Confirm &amp; write
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setPhase("idle");
                  setPlan(null);
                  setPhaseMessage(null);
                  setThinkingLines([]);
                  setError(null);
                  setClarifyDraft("");
                  setBaseInstruction(null);
                  setClarifications([]);
                  emitPreview([]);
                }}
                className="rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-600 transition hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                Decline
              </button>
            </div>
          ) : null}

          {phase === "applying" ? (
            <div className="flex items-center justify-between gap-2 rounded-xl border border-brand-border/70 bg-brand-blush/40 px-3 py-2 dark:border-brand/30 dark:bg-[#1e1616]/40">
              <span className="flex items-center gap-2 text-[12px] font-medium text-zinc-700 dark:text-zinc-300">
                <ActionSpinner className="h-3.5 w-3.5 text-brand" />
                Writing edits…
              </span>
              <button
                type="button"
                onClick={stopEdits}
                className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-[12px] font-semibold text-red-700 transition hover:bg-red-100 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-950/70"
              >
                Stop edits
              </button>
            </div>
          ) : null}

          {/* Confirm step: a fresh box to answer / narrow the plan. Original
              request stays locked above — clarifications stack on top of it. */}
          {phase === "confirm" && plan ? (
            <div className="rounded-xl border border-brand-border/70 bg-brand-blush/20 focus-within:border-brand focus-within:bg-white dark:border-brand/30 dark:bg-[#1e1616]/30 dark:focus-within:border-brand/50 dark:focus-within:bg-zinc-950">
              <textarea
                data-refine-clarify
                rows={2}
                value={clarifyDraft}
                onChange={(e) => setClarifyDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (clarifyDraft.trim().length >= 2) {
                      void requestPlan({ clarification: clarifyDraft });
                    }
                  }
                }}
                disabled={busy}
                placeholder="Narrow or answer the plan — e.g. “only lesson 2”…"
                className="min-h-[52px] w-full resize-none bg-transparent px-3.5 pt-3 text-[13px] text-zinc-900 outline-none placeholder:text-zinc-400 disabled:opacity-60 dark:text-zinc-100"
              />
              <div className="flex items-center justify-between gap-2 px-2.5 pb-2.5">
                <p className="px-1 text-[10px] text-zinc-400">
                  Keeps your original request · Enter to update the plan
                </p>
                <button
                  type="button"
                  disabled={busy || clarifyDraft.trim().length < 2}
                  onClick={() =>
                    void requestPlan({ clarification: clarifyDraft })
                  }
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3.5 text-[12px] font-semibold text-white transition hover:bg-brand-hover disabled:opacity-40"
                >
                  Update plan
                </button>
              </div>
            </div>
          ) : phase === "planning" && baseInstruction ? (
            <div className="rounded-xl border border-brand-border/70 bg-brand-blush/30 px-3.5 py-3 dark:border-brand/30 dark:bg-[#1e1616]/40">
              <p className="flex items-center gap-2 text-[12px] font-medium text-zinc-700 dark:text-zinc-300">
                <ActionSpinner className="h-3.5 w-3.5 text-brand" />
                Updating the plan with your clarification…
              </p>
              <p className="mt-1 truncate text-[11px] text-zinc-500">
                Keeping: {baseInstruction}
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-zinc-200 bg-zinc-50/50 focus-within:border-brand-border focus-within:bg-white dark:border-zinc-800 dark:bg-zinc-900/40 dark:focus-within:border-brand/40 dark:focus-within:bg-zinc-950">
              <textarea
                data-refine-main
                rows={2}
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void requestPlan();
                  }
                }}
                disabled={busy}
                placeholder={`Describe the edit for ${AI_ASSISTANT_NAME}…`}
                className="min-h-[52px] w-full resize-none bg-transparent px-3.5 pt-3 text-[13px] text-zinc-900 outline-none placeholder:text-zinc-400 disabled:opacity-60 dark:text-zinc-100"
              />
              <div className="flex items-center justify-between gap-2 px-2.5 pb-2.5">
                <p className="px-1 text-[10px] text-zinc-400">
                  Enter to plan · Shift+Enter for new line
                </p>
                <button
                  type="button"
                  disabled={busy || instruction.trim().length < 8}
                  onClick={() => void requestPlan()}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3.5 text-[12px] font-semibold text-white transition hover:bg-brand-hover disabled:opacity-40"
                >
                  {phase === "planning" ? (
                    <ActionSpinner className="h-3.5 w-3.5" />
                  ) : null}
                  {phase === "planning" ? "Planning…" : "Plan edit"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
