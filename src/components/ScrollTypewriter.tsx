"use client";

import { useEffect, useRef, useState } from "react";

export type TypewriterSegment = { text: string; className?: string };

/**
 * Reveals text the first time it scrolls into view by fading each unit in,
 * staggered — like content materializing as it's generated.
 *  - `mode="words"` (default): each word fades + de-blurs + rises in.
 *  - `mode="chars"`: each character fades + de-blurs in. Use `segments` to keep
 *    inline styling (e.g. a coloured accent word).
 * All units hold their final space immediately (only opacity/transform animate),
 * so the layout never shifts. NOTE: don't wrap this in an opacity-fading
 * container (e.g. `Reveal`) or the per-unit stagger gets masked.
 */
export function ScrollTypewriter({
  text,
  segments,
  className,
  mode = "words",
  wordStepMs = 70,
  charStepMs = 22,
}: {
  text?: string;
  segments?: TypewriterSegment[];
  className?: string;
  mode?: "words" | "chars";
  /** Per-word stagger in word mode (ms). */
  wordStepMs?: number;
  /** Per-character stagger in char mode (ms). */
  charStepMs?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setStarted(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setStarted(true);
            obs.disconnect();
            break;
          }
        }
      },
      { rootMargin: "0px 0px -17% 0px", threshold: 0.2 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const segs: TypewriterSegment[] = segments ?? [{ text: text ?? "" }];

  if (mode === "chars") {
    let charIdx = 0;
    return (
      <span ref={ref} className={className}>
        {segs.map((s, si) =>
          Array.from(s.text).map((ch, ci) => {
            const key = `${si}-${ci}`;
            if (ch === " ") return <span key={key}> </span>;
            const delay = charIdx * charStepMs;
            charIdx += 1;
            return (
              <span
                key={key}
                className={`tw-char${started ? " tw-go" : ""}${s.className ? ` ${s.className}` : ""}`}
                style={{ animationDelay: `${delay}ms` }}
              >
                {ch}
              </span>
            );
          })
        )}
      </span>
    );
  }

  const full = segs.map((s) => s.text).join("");
  const tokens = full.split(/(\s+)/);
  let wordIdx = 0;
  return (
    <span ref={ref} className={className}>
      {tokens.map((tok, i) => {
        if (tok === "") return null;
        if (/^\s+$/.test(tok)) return <span key={i}>{tok}</span>;
        const delay = wordIdx * wordStepMs;
        wordIdx += 1;
        return (
          <span
            key={i}
            className={`tw-word${started ? " tw-go" : ""}`}
            style={{ animationDelay: `${delay}ms` }}
          >
            {tok}
          </span>
        );
      })}
    </span>
  );
}
