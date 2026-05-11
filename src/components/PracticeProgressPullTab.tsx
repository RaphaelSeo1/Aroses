"use client";

import Link from "next/link";
import { createPortal } from "react-dom";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { ProgressRings } from "@/components/progress/ProgressRings";

const RING_EASE =
  "transition-[stroke-dashoffset] duration-[1200ms] cubic-bezier(0.22,0.82,0.28,1)";

const TAB_W_PX = 44;

function SweepBar({
  label,
  value,
  variant,
}: {
  label: string;
  value: number;
  variant: "modules" | "mastery";
}) {
  const w = Math.min(100, Math.max(0, value));
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
        <span>{label}</span>
        <span className="tabular-nums text-zinc-900 dark:text-zinc-100">
          {Math.round(value)}%
        </span>
      </div>
      <div
        className="mt-2 h-4 overflow-hidden rounded-full border border-zinc-200/80 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800/90"
        role="progressbar"
        aria-valuenow={Math.round(w)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={`h-full rounded-full transition-[width] duration-[1200ms] cubic-bezier(0.22,0.82,0.28,1) ${
            variant === "modules"
              ? "bg-gradient-to-r from-brand to-brand-hover"
              : "bg-gradient-to-r from-red-400 via-brand to-brand-hover"
          }`}
          style={{ width: `${w}%` }}
        />
      </div>
    </div>
  );
}

export function PracticeProgressPullTab({
  open,
  onOpenChange,
  courseTitle,
  sourceLabel,
  completedCount,
  totalModules,
  progressPct,
  masteryPct,
  panelEyebrow,
  modulesDetailLine,
  quizMetricSource = "materialBank",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courseTitle: string;
  sourceLabel: string;
  completedCount: number;
  totalModules: number;
  progressPct: number;
  masteryPct: number | null;
  panelEyebrow?: string;
  /** Full subtitle under title (replaces `sourceLabel · n/n modules`). */
  modulesDetailLine?: string;
  /** `profileCourse` = same inner-ring math as Profile Progress (all attempts). */
  quizMetricSource?: "materialBank" | "profileCourse";
}) {
  const [viz, setViz] = useState({ mod: 0, quiz: 0 });
  const sweepTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [ringsCompact, setRingsCompact] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [portalReady, setPortalReady] = useState(false);

  useEffect(() => {
    setPortalReady(true);
  }, []);

  const measurePanel = useCallback(() => {
    const el = panelRef.current;
    if (!el) return;
    const w = Math.round(el.getBoundingClientRect().width);
    if (w > 0) setRingsCompact(w < 260);
  }, []);

  useLayoutEffect(() => {
    measurePanel();
    const el = panelRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measurePanel());
    ro.observe(el);
    return () => ro.disconnect();
  }, [measurePanel]);

  useEffect(() => {
    setReduceMotion(
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }, []);

  useEffect(() => {
    if (!open) {
      setViz({ mod: 0, quiz: 0 });
      return;
    }

    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    setViz({ mod: 0, quiz: 0 });

    if (reduced) {
      setViz({
        mod: progressPct,
        quiz: masteryPct ?? 0,
      });
      return;
    }

    if (sweepTimerRef.current) clearTimeout(sweepTimerRef.current);
    sweepTimerRef.current = setTimeout(() => {
      setViz({
        mod: progressPct,
        quiz: masteryPct ?? 0,
      });
      sweepTimerRef.current = null;
    }, 140);

    return () => {
      if (sweepTimerRef.current) clearTimeout(sweepTimerRef.current);
    };
  }, [open, progressPct, masteryPct]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  useEffect(() => {
    const id = window.requestAnimationFrame(() => measurePanel());
    return () => cancelAnimationFrame(id);
  }, [open, measurePanel]);

  const innerQuizForRing = masteryPct == null ? null : viz.quiz;

  /** Panel uses `right: TAB_W_PX`; translateX(100%) alone leaves a TAB_W_PX‑wide strip visible — add TAB_W_PX more to clear the viewport. */
  const panelClosedX = `calc(100% + ${TAB_W_PX}px)`;

  const sharedShadow =
    "shadow-[0_12px_40px_-8px_rgba(0,0,0,0.22)] dark:shadow-black/40";

  const panel = (
    <div
      ref={panelRef}
      id="practice-progress-panel"
      role="region"
      aria-label="Practice progress"
      aria-hidden={!open}
      className={`fixed z-[140] flex max-h-[90vh] flex-col overflow-hidden rounded-l-2xl border border-r-0 border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-950 ${sharedShadow} ${
        reduceMotion
          ? ""
          : "transition-transform duration-500 ease-[cubic-bezier(0.25,0.82,0.35,1)]"
      } ${!open ? "pointer-events-none" : ""}`}
      style={{
        right: TAB_W_PX,
        top: "50%",
        width: "min(22rem, calc(100vw - 3rem))",
        maxWidth: "calc(100vw - 3rem)",
        transform: open
          ? "translateY(-50%) translateX(0)"
          : `translateY(-50%) translateX(${panelClosedX})`,
      }}
    >
      <div className="shrink-0 border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          {panelEyebrow ?? "This upload"}
        </p>
        <h2 className="mt-1 break-words text-base font-semibold leading-snug text-zinc-900 dark:text-zinc-50">
          {courseTitle}
        </h2>
        <p className="mt-1 break-words text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
          {modulesDetailLine ??
            `${sourceLabel} · ${completedCount}/${totalModules} modules`}
        </p>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden overscroll-contain px-4 py-4">
        <div className="flex flex-col items-center">
          <ProgressRings
            ringId="practice-pull"
            modulePct={viz.mod}
            quizPct={innerQuizForRing}
            strokeTransitionClass={RING_EASE}
            size={ringsCompact ? "sm" : "lg"}
          />
          <p className="mt-3 text-center text-[11px] leading-snug text-zinc-600 dark:text-zinc-400">
            {quizMetricSource === "profileCourse" ? (
              <>
                <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                  Outer ring
                </span>{" "}
                · module checkpoints across this course.{" "}
                <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                  Inner ring
                </span>{" "}
                · quiz accuracy on all attempts (matches Profile → Progress).
              </>
            ) : (
              <>
                <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                  Outer ring
                </span>{" "}
                · modules finished here.{" "}
                <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                  Inner ring
                </span>{" "}
                · last try correct on questions you&apos;ve attempted.
              </>
            )}
          </p>
        </div>

        <div className="space-y-4 rounded-xl border border-zinc-200/90 bg-zinc-50 px-3 py-3 dark:border-zinc-700 dark:bg-zinc-900/50">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Animated gauges
          </p>
          <SweepBar label="Module completion" value={viz.mod} variant="modules" />
          <SweepBar
            label={
              quizMetricSource === "profileCourse"
                ? masteryPct == null
                  ? "Quiz accuracy (course, no attempts yet)"
                  : "Quiz accuracy (course, all attempts)"
                : masteryPct == null
                  ? "Bank mastery (no attempts yet)"
                  : "Bank mastery (last try)"
            }
            value={masteryPct == null ? 0 : viz.quiz}
            variant="mastery"
          />
          {masteryPct == null ? (
            <p className="text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
              {quizMetricSource === "profileCourse" ? (
                <>
                  Answer a quiz question in this course — then this bar and inner
                  ring match your{" "}
                  <strong className="font-medium text-zinc-700 dark:text-zinc-300">
                    Profile → Progress
                  </strong>{" "}
                  accuracy (correct ÷ attempts).
                </>
              ) : (
                <>
                  Run the module quiz once — then this bar and inner ring track how
                  often your{" "}
                  <strong className="font-medium text-zinc-700 dark:text-zinc-300">
                    last try
                  </strong>{" "}
                  was correct per question.
                </>
              )}
            </p>
          ) : null}
        </div>

        <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
          Profile → Progress adds rings and pulse{" "}
          <strong className="font-medium text-zinc-800 dark:text-zinc-200">
            across all courses
          </strong>
          .
        </p>

        <Link
          href="/dashboard/profile?tab=progress"
          onClick={() => onOpenChange(false)}
          className="inline-flex w-full shrink-0 items-center justify-center rounded-full border border-brand-border bg-white px-4 py-2.5 text-sm font-semibold text-brand shadow-sm hover:bg-brand-blush dark:border-brand-border/50 dark:bg-zinc-950 dark:text-brand-soft dark:hover:bg-brand-blush/10"
        >
          Open full progress dashboard
        </Link>
      </div>
    </div>
  );

  const tab = (
    <button
      type="button"
      onClick={() => onOpenChange(!open)}
      aria-expanded={open}
      aria-controls="practice-progress-panel"
      style={{
        width: TAB_W_PX,
        right: 0,
        top: "50%",
        transform: "translateY(-50%)",
      }}
      className={`fixed z-[141] flex min-h-[7rem] cursor-pointer flex-col items-center justify-center gap-2 rounded-l-lg border border-r-0 border-zinc-200 bg-gradient-to-b from-white to-zinc-50 px-1 py-4 text-[10px] font-bold uppercase tracking-widest text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:from-zinc-950 dark:to-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-900 ${sharedShadow}`}
    >
      <span style={{ writingMode: "vertical-rl" }}>Progress</span>
    </button>
  );

  if (!portalReady) return null;

  return createPortal(
    <>
      {panel}
      {tab}
    </>,
    document.body
  );
}
