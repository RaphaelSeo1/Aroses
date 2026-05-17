"use client";

import type { CSSProperties, ReactNode } from "react";

/**
 * Glass-morphism panel for the immersive Mentored Learning view.
 *
 *   - Heavy backdrop blur over the cloudy background
 *   - Translucent white with a subtle inner highlight on the top edge
 *   - Soft drop shadow lifts the panel off the gradient
 *   - Fades + scales in on mount so new content materializes
 *
 * Use `tone="question"` for the check-question card (warmer tint) and
 * `tone="reply"` for the AI's response card (subtle brand tint).
 */
export function GlassPanel({
  children,
  tone = "default",
  className = "",
  style,
  delayMs,
}: {
  children: ReactNode;
  tone?: "default" | "question" | "reply" | "subtle";
  className?: string;
  style?: CSSProperties;
  /** Optional stagger so adjacent panels don't pop in simultaneously. */
  delayMs?: number;
}) {
  const toneClasses =
    tone === "question"
      ? "bg-amber-50/40 ring-amber-200/40"
      : tone === "reply"
        ? "bg-fuchsia-50/40 ring-fuchsia-200/40"
        : tone === "subtle"
          ? "bg-white/30 ring-white/30"
          : "bg-white/45 ring-white/50";

  return (
    <div
      // We use `backdrop-blur-md` on mobile (≈12px) and bump up to `xl`
      // (≈24px) on sm+. `2xl` (40px) tanks scrolling on lower-end mobile
      // GPUs — the visual difference vs. xl is minimal but the perf
      // gain is huge. `transform-gpu` forces the panel onto its own
      // compositor layer so the blur isn't recomputed every paint.
      className={`glass-panel transform-gpu relative rounded-3xl border border-white/40 p-6 shadow-[0_25px_60px_-25px_rgba(60,60,90,0.25)] ring-1 backdrop-blur-md backdrop-saturate-150 sm:backdrop-blur-xl ${toneClasses} ${className}`}
      style={{
        animationDelay:
          typeof delayMs === "number" ? `${delayMs}ms` : undefined,
        ...style,
      }}
    >
      {/* Subtle highlight on the top edge so the panel looks lit from above. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-3 top-0 h-px rounded-full"
        style={{
          background:
            "linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.9) 50%, rgba(255,255,255,0) 100%)",
        }}
      />
      {children}
      <style jsx>{`
        .glass-panel {
          animation: glass-in 0.55s cubic-bezier(0.22, 0.61, 0.36, 1) both;
          will-change: transform, opacity;
        }
        @keyframes glass-in {
          0% {
            opacity: 0;
            transform: translateY(8px) scale(0.985);
          }
          100% {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .glass-panel {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}
