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
import { APP_NAME } from "@/lib/brand";

const RING_EASE =
  "transition-[stroke-dashoffset] duration-[1200ms] cubic-bezier(0.22,0.82,0.28,1)";

// Pill lives at top-right just below the app header so it doesn't fight the
// voice tutor dock (bottom-right) or its transcript tab (mid-right).
const PILL_TOP_PX = 88; // ~5.5rem — clears the global header
const PILL_RIGHT_PX = 16; // 1rem
// Used to slide the panel just enough to fully clear the pill when closed.
const PILL_BLEED_PX = 56;

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
        className="mt-2 h-3.5 overflow-hidden rounded-full border border-zinc-200/90 bg-zinc-100/90 shadow-inner shadow-zinc-900/5 dark:border-zinc-600 dark:bg-zinc-800/80 dark:shadow-black/20"
        role="progressbar"
        aria-valuenow={Math.round(w)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={`h-full rounded-full shadow-sm ring-1 ring-black/5 transition-[width] duration-[1200ms] cubic-bezier(0.22,0.82,0.28,1) dark:ring-white/10 ${
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

/** 28px dual-ring used inside the pill button. Outer = modules, inner = mastery. */
function PillRing({
  progress,
  mastery,
}: {
  progress: number;
  mastery: number | null;
}) {
  const size = 26;
  const cx = size / 2;
  const cy = size / 2;
  const outerR = 11;
  const innerR = 6.5;
  const outerC = 2 * Math.PI * outerR;
  const innerC = 2 * Math.PI * innerR;
  const outerOffset = outerC * (1 - progress / 100);
  const innerOffset = mastery == null ? innerC : innerC * (1 - mastery / 100);
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden="true"
      className="shrink-0"
    >
      <circle
        cx={cx}
        cy={cy}
        r={outerR}
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.15"
        strokeWidth="2.5"
      />
      <circle
        cx={cx}
        cy={cy}
        r={outerR}
        fill="none"
        stroke="url(#pill-ring-outer)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={outerC}
        strokeDashoffset={outerOffset}
        transform={`rotate(-90 ${cx} ${cy})`}
      />
      <circle
        cx={cx}
        cy={cy}
        r={innerR}
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.12"
        strokeWidth="2"
      />
      {mastery != null ? (
        <circle
          cx={cx}
          cy={cy}
          r={innerR}
          fill="none"
          stroke="url(#pill-ring-inner)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={innerC}
          strokeDashoffset={innerOffset}
          transform={`rotate(-90 ${cx} ${cy})`}
        />
      ) : null}
      <defs>
        <linearGradient id="pill-ring-outer" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f43f5e" />
          <stop offset="100%" stopColor="#be123c" />
        </linearGradient>
        <linearGradient id="pill-ring-inner" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fb7185" />
          <stop offset="100%" stopColor="#e11d48" />
        </linearGradient>
      </defs>
    </svg>
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

  // Slide the panel fully past the pill so nothing peeks when closed.
  const panelClosedX = `calc(100% + ${PILL_BLEED_PX}px)`;

  const sharedShadow =
    "shadow-[0_12px_40px_-8px_rgba(0,0,0,0.22)] dark:shadow-black/40";

  const panel = (
    <div
      ref={panelRef}
      id="practice-progress-panel"
      role="region"
      aria-label="Practice progress"
      aria-hidden={!open}
      className={`fixed z-[140] flex flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-950 ${sharedShadow} ${
        reduceMotion
          ? ""
          : "transition-transform duration-500 ease-[cubic-bezier(0.25,0.82,0.35,1)]"
      } ${!open ? "pointer-events-none" : ""}`}
      style={{
        right: PILL_RIGHT_PX,
        // Park the panel just under the pill so it visually unfurls from it.
        top: PILL_TOP_PX + 48,
        width: "min(22rem, calc(100vw - 2rem))",
        maxWidth: "calc(100vw - 2rem)",
        maxHeight: `calc(100vh - ${PILL_TOP_PX + 64}px)`,
        transform: open ? "translateX(0)" : `translateX(${panelClosedX})`,
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
          Open Profile → Progress — your {APP_NAME} overview includes rings{" "}
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

  const pillProgress = Math.max(0, Math.min(100, Math.round(progressPct)));
  const pillMastery =
    masteryPct == null ? null : Math.max(0, Math.min(100, Math.round(masteryPct)));

  const tab = (
    <button
      type="button"
      onClick={() => onOpenChange(!open)}
      aria-expanded={open}
      aria-controls="practice-progress-panel"
      title="Practice progress"
      style={{
        right: PILL_RIGHT_PX,
        top: PILL_TOP_PX,
      }}
      className={`fixed z-[141] inline-flex h-9 cursor-pointer items-center gap-2 rounded-full border border-zinc-200/90 bg-white/95 pl-1.5 pr-3 text-[11px] font-semibold tracking-wide text-zinc-700 backdrop-blur transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950/90 dark:text-zinc-200 dark:hover:bg-zinc-900 ${sharedShadow}`}
    >
      <PillRing progress={pillProgress} mastery={pillMastery} />
      <span className="uppercase tracking-widest text-[10px]">Progress</span>
      <span className="tabular-nums text-zinc-500 dark:text-zinc-400">
        {pillProgress}%
      </span>
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
