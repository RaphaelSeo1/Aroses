"use client";

import { useEffect, useState } from "react";
import { AnimatedWaveform } from "@/components/immersive/AnimatedWaveform";
import { GlassPanel } from "@/components/immersive/GlassPanel";
import { ImmersiveShell } from "@/components/immersive/ImmersiveShell";

/**
 * Visual loading screen used while we're either:
 *   - fetching the user's tutor session (fast),
 *   - or asking Claude to build a fresh lesson plan (10-30s).
 *
 * The previous version was a single line of subtle text inside a glass
 * card, which felt empty for the longer plan-generation case. This one
 * shows an animated progress bar, a rotating "what we're doing now"
 * caption, and the section header so the student keeps context about
 * what's about to open.
 */
export function LessonPlanLoading({
  courseTitle,
  moduleIdx,
  moduleCount,
  moduleTitle,
  stage = "plan",
  topBar,
  onRequestExit,
}: {
  courseTitle?: string;
  moduleIdx?: number;
  moduleCount?: number;
  moduleTitle?: string;
  /** "session" is short; "plan" is the slow Claude generation. */
  stage?: "session" | "plan";
  topBar?: React.ReactNode;
  /** Shown on the loading card so Exit is reachable without the top bar. */
  onRequestExit?: () => void;
}) {
  const STEPS_PLAN = [
    "Reading the source lesson",
    "Breaking it into bite-sized concepts",
    "Crafting check questions",
    "Calibrating depth to your level",
    "Almost there — opening your tutor",
  ];
  const STEPS_SESSION = [
    "Finding where you left off",
    "Loading your tutor session",
  ];
  const steps = stage === "plan" ? STEPS_PLAN : STEPS_SESSION;

  // ---- rotating step caption ----
  // Plan generation is ~10-25s on average; rotate captions on a longer
  // cadence so each one feels like a real beat. Session load is fast,
  // so cycle faster.
  const [stepIdx, setStepIdx] = useState(0);
  useEffect(() => {
    const cadence = stage === "plan" ? 3500 : 900;
    const lastIdx = steps.length - 1;
    const id = window.setInterval(() => {
      setStepIdx((i) => Math.min(i + 1, lastIdx));
    }, cadence);
    return () => window.clearInterval(id);
  }, [stage, steps.length]);

  // ---- determinate-ish progress ----
  // Real progress is unknowable (Claude streams variably), so we ease an
  // asymptote toward 95% over ~18s. Once the real call returns the
  // parent unmounts this component and the runner takes over.
  const [pct, setPct] = useState(() => (stage === "plan" ? 4 : 30));
  useEffect(() => {
    const id = window.setInterval(() => {
      setPct((p) => {
        if (stage !== "plan") return Math.min(p + 4, 92);
        const remaining = 95 - p;
        const step = Math.max(0.4, remaining * 0.04);
        return Math.min(p + step, 95);
      });
    }, 300);
    return () => window.clearInterval(id);
  }, [stage]);

  return (
    <ImmersiveShell
      topBar={topBar}
      bottomBar={
        // Slim decorative strip — no input controls during loading.
        <div className="pointer-events-none flex justify-center pb-[max(1rem,env(safe-area-inset-bottom))] pt-2">
          <div className="h-12 w-full max-w-md opacity-80">
            <AnimatedWaveform mode="listening" />
          </div>
        </div>
      }
    >
      {courseTitle ? (
        <div className="text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-zinc-500">
            {courseTitle}
            {typeof moduleIdx === "number" && typeof moduleCount === "number"
              ? ` · Section ${moduleIdx + 1} of ${moduleCount}`
              : null}
          </p>
          {moduleTitle ? (
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900 sm:text-3xl">
              {moduleTitle}
            </h1>
          ) : null}
        </div>
      ) : null}

      <GlassPanel className="mt-8" tone="default" delayMs={80}>
        <div className="flex flex-col items-center gap-5 py-2">
          <div className="flex items-center gap-3 text-zinc-700">
            <PulsingDots />
            <p className="text-base font-medium">
              {stage === "plan"
                ? "Building your lesson plan"
                : "Opening your session"}
            </p>
          </div>

          {/* Progress bar */}
          <div className="w-full max-w-md">
            <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-white/55 ring-1 ring-white/60">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-fuchsia-400 via-violet-400 to-indigo-400 shadow-[0_0_12px_rgba(192,132,252,0.6)] transition-[width] duration-300 ease-out"
                style={{ width: `${pct}%` }}
              />
              <div
                aria-hidden
                className="absolute inset-0 -translate-x-full animate-[lp-shimmer_2.6s_infinite] bg-gradient-to-r from-transparent via-white/55 to-transparent"
              />
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px] text-zinc-500">
              <span className="font-medium tabular-nums">
                {Math.round(pct)}%
              </span>
              <span>
                {stage === "plan"
                  ? "Usually 10–25 seconds"
                  : "Just a moment…"}
              </span>
            </div>
          </div>

          {/* Rotating step caption */}
          <p
            key={stepIdx}
            className="lp-step text-center text-sm leading-relaxed text-zinc-600"
          >
            {steps[stepIdx]}
            <span className="ml-1 inline-block animate-pulse text-zinc-400">
              …
            </span>
          </p>

          {/* Step ticks */}
          {stage === "plan" ? (
            <ol className="mt-1 flex w-full max-w-md flex-col gap-1.5 text-[12px] text-zinc-500">
              {steps.map((s, i) => {
                const reached = i <= stepIdx;
                const active = i === stepIdx;
                return (
                  <li key={s} className="flex items-center gap-2">
                    <span
                      className={
                        reached
                          ? active
                            ? "h-1.5 w-1.5 rounded-full bg-fuchsia-500 shadow-[0_0_8px_rgba(217,70,239,0.55)]"
                            : "h-1.5 w-1.5 rounded-full bg-emerald-500"
                          : "h-1.5 w-1.5 rounded-full bg-white/80 ring-1 ring-zinc-300"
                      }
                      aria-hidden
                    />
                    <span
                      className={
                        reached
                          ? active
                            ? "font-medium text-zinc-800"
                            : "text-zinc-600 line-through decoration-zinc-300"
                          : ""
                      }
                    >
                      {s}
                    </span>
                  </li>
                );
              })}
            </ol>
          ) : null}
        </div>
      </GlassPanel>

      {onRequestExit ? (
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={onRequestExit}
            className="rounded-full border border-white/60 bg-white/70 px-5 py-2 text-sm font-medium text-zinc-700 shadow-sm backdrop-blur-md transition hover:bg-white/90"
          >
            Leave course
          </button>
        </div>
      ) : null}

      <style jsx>{`
        .lp-step {
          animation: lp-step-in 0.5s ease-out both;
        }
        @keyframes lp-step-in {
          0% {
            opacity: 0;
            transform: translateY(4px);
          }
          100% {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes lp-shimmer {
          0% {
            transform: translateX(-100%);
          }
          100% {
            transform: translateX(100%);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .lp-step {
            animation: none;
          }
        }
      `}</style>
    </ImmersiveShell>
  );
}

function PulsingDots() {
  return (
    <span
      aria-hidden
      className="inline-flex items-center gap-1.5"
    >
      <span className="lp-dot lp-dot-1 h-2 w-2 rounded-full bg-fuchsia-400" />
      <span className="lp-dot lp-dot-2 h-2 w-2 rounded-full bg-violet-400" />
      <span className="lp-dot lp-dot-3 h-2 w-2 rounded-full bg-indigo-400" />
      <style jsx>{`
        .lp-dot {
          display: inline-block;
          animation: lp-dot-bounce 1.2s ease-in-out infinite;
        }
        .lp-dot-1 {
          animation-delay: 0ms;
        }
        .lp-dot-2 {
          animation-delay: 160ms;
        }
        .lp-dot-3 {
          animation-delay: 320ms;
        }
        @keyframes lp-dot-bounce {
          0%,
          80%,
          100% {
            transform: scale(0.7);
            opacity: 0.55;
          }
          40% {
            transform: scale(1);
            opacity: 1;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .lp-dot {
            animation: none;
            opacity: 0.85;
          }
        }
      `}</style>
    </span>
  );
}
