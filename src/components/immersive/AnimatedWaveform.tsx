"use client";

import { useEffect, useRef, useState } from "react";

type Mode = "speaking" | "listening" | "idle";

/**
 * Glowing pink→purple waveform for the immersive Mentored Learning view.
 *
 * Implementation: 32 vertical bars driven by sine + hash-offset so the
 * wave looks organic, not synchronized. Heights/positions are written
 * directly to each <rect> via refs on rAF — no React state per frame —
 * so the animation costs ~0 reconciliation work and stays at 60fps even
 * when the rest of the page is busy.
 *
 *   - mode="speaking"   → tall, fast, vivid (AI voice playing)
 *   - mode="listening"  → soft, breathing (mic open)
 *   - mode="idle"       → very subtle baseline pulse
 *
 * Respects `prefers-reduced-motion` by freezing the bars at a static
 * mode-appropriate profile.
 */
export function AnimatedWaveform({
  mode,
  className = "",
}: {
  mode: Mode;
  className?: string;
}) {
  const BARS = 32;
  const WIDTH = 360;
  const HEIGHT = 96;
  const MID = HEIGHT / 2;
  const gap = WIDTH / BARS;
  const barWidth = Math.max(2, gap * 0.45);

  const rectRefs = useRef<Array<SVGRectElement | null>>([]);
  const modeRef = useRef<Mode>(mode);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number>(0);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    // Write a single bar's geometry directly to its <rect>. Defined inside
    // the effect so it closes over MID without needing it in the dep list.
    const setBarHeight = (i: number, h: number) => {
      const rect = rectRefs.current[i];
      if (!rect) return;
      rect.setAttribute("y", String(MID - h / 2));
      rect.setAttribute("height", String(h));
    };

    if (reducedMotion) {
      const staticHeight =
        mode === "speaking" ? 32 : mode === "listening" ? 18 : 8;
      for (let i = 0; i < BARS; i++) {
        const distFromCenter =
          Math.abs(i - (BARS - 1) / 2) / ((BARS - 1) / 2);
        const taper = 1 - distFromCenter ** 1.6 * 0.65;
        setBarHeight(i, Math.max(4, taper * staticHeight));
      }
      return;
    }

    startRef.current = performance.now();

    const tick = (now: number) => {
      const t = (now - startRef.current) / 1000;
      const current = modeRef.current;
      const speed =
        current === "speaking" ? 5.2 : current === "listening" ? 1.8 : 1.0;
      const amplitude =
        current === "speaking" ? 38 : current === "listening" ? 14 : 6;

      for (let i = 0; i < BARS; i++) {
        const distFromCenter =
          Math.abs(i - (BARS - 1) / 2) / ((BARS - 1) / 2);
        const taper = 1 - distFromCenter ** 1.6 * 0.65;
        const phase = (i * 37) % 11;
        const wave =
          Math.sin(t * speed + phase) * 0.6 +
          Math.sin(t * speed * 1.7 + phase * 0.6) * 0.4;
        const h = Math.max(4, taper * (amplitude * (0.55 + wave * 0.5) + 6));
        setBarHeight(i, h);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [mode, reducedMotion, MID]);

  // Initial bars rendered once. Subsequent height updates happen via
  // refs above — React never touches these elements after first paint.
  const initialBars = Array.from({ length: BARS }, (_, i) => {
    const x = i * gap + (gap - barWidth) / 2;
    return (
      <rect
        key={i}
        ref={(el) => {
          rectRefs.current[i] = el;
        }}
        x={x}
        y={MID - 4}
        width={barWidth}
        height={8}
        rx={barWidth / 2}
        fill="url(#wf-grad)"
      />
    );
  });

  // Keep the glow filter inside the SVG box (`overflow: hidden`) and
  // pin its filter region tight to the source area so it can't bleed
  // into adjacent rows of the layout — that was making the bars look
  // like they were crossing through the toggle/textarea below the
  // dock's activity row.
  return (
    <div className={`relative overflow-hidden ${className}`}>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width="100%"
        height="100%"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden
        className="block"
        style={{ overflow: "hidden" }}
      >
        <defs>
          <linearGradient id="wf-grad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#f472b6" />
            <stop offset="55%" stopColor="#c084fc" />
            <stop offset="100%" stopColor="#818cf8" />
          </linearGradient>
          {/* Tight filter region — just enough room for the blur without
              spilling outside the SVG's own bounds. */}
          <filter id="wf-glow" x="-5%" y="-5%" width="110%" height="110%">
            <feGaussianBlur stdDeviation="1.6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <g filter="url(#wf-glow)">{initialBars}</g>
      </svg>
    </div>
  );
}
