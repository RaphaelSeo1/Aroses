"use client";

import { useEffect, useRef, useState } from "react";

type Mode = "speaking" | "listening" | "idle";

/**
 * Glowing pink→purple waveform for the immersive Mentored Learning view.
 *
 * Implementation: 32 vertical bars. Each bar's height is driven by a sine
 * combined with a hash-offset so the wave looks organic, not synchronized.
 *
 *   - mode="speaking"   → tall, fast, vivid (AI voice playing)
 *   - mode="listening"  → soft, breathing (mic open)
 *   - mode="idle"       → very subtle baseline pulse
 *
 * Renders as a single SVG with a gradient stroke + soft glow filter. We
 * step the animation with requestAnimationFrame so it pauses cleanly when
 * the tab is hidden.
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

  const [heights, setHeights] = useState<number[]>(() =>
    Array.from({ length: BARS }, () => 8)
  );
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number>(0);
  const modeRef = useRef<Mode>(mode);
  const [reducedMotion, setReducedMotion] = useState(false);

  // Track the latest mode without restarting the animation loop.
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  // Respect prefers-reduced-motion. When set, swap the animated bars for a
  // static "presence indicator" — short bars when idle, taller solid bars
  // when speaking, mid-height when listening. No rAF, no flicker.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (reducedMotion) {
      // Render a stable bar profile based on the current mode.
      const staticHeight =
        mode === "speaking" ? 32 : mode === "listening" ? 18 : 8;
      setHeights((prev) =>
        prev.map((_, i) => {
          const distFromCenter =
            Math.abs(i - (BARS - 1) / 2) / ((BARS - 1) / 2);
          const taper = 1 - distFromCenter ** 1.6 * 0.65;
          return Math.max(4, taper * staticHeight);
        })
      );
      return;
    }
    startRef.current = performance.now();

    const tick = (now: number) => {
      const t = (now - startRef.current) / 1000;
      const current = modeRef.current;

      const next: number[] = new Array(BARS);
      for (let i = 0; i < BARS; i++) {
        // Distance from center → bars taper at the edges.
        const distFromCenter = Math.abs(i - (BARS - 1) / 2) / ((BARS - 1) / 2);
        const taper = 1 - distFromCenter ** 1.6 * 0.65;

        // Per-bar phase offset gives organic, non-synced motion.
        const phase = (i * 37) % 11;
        const speed =
          current === "speaking" ? 5.2 : current === "listening" ? 1.8 : 1.0;
        const amplitude =
          current === "speaking" ? 38 : current === "listening" ? 14 : 6;

        const wave =
          Math.sin(t * speed + phase) * 0.6 +
          Math.sin(t * speed * 1.7 + phase * 0.6) * 0.4;
        const h = Math.max(4, taper * (amplitude * (0.55 + wave * 0.5) + 6));
        next[i] = h;
      }
      setHeights(next);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [mode, reducedMotion]);

  const gap = WIDTH / BARS;
  const barWidth = Math.max(2, gap * 0.45);

  return (
    <div className={`relative ${className}`}>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width="100%"
        height="100%"
        aria-hidden
        className="block"
      >
        <defs>
          <linearGradient id="wf-grad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#f472b6" />
            <stop offset="55%" stopColor="#c084fc" />
            <stop offset="100%" stopColor="#818cf8" />
          </linearGradient>
          <filter id="wf-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <g filter="url(#wf-glow)">
          {heights.map((h, i) => {
            const x = i * gap + (gap - barWidth) / 2;
            return (
              <rect
                key={i}
                x={x}
                y={MID - h / 2}
                width={barWidth}
                height={h}
                rx={barWidth / 2}
                fill="url(#wf-grad)"
              />
            );
          })}
        </g>
      </svg>
    </div>
  );
}
