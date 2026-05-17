"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Reveals a block of text word-by-word with a soft fade-in.
 *
 * Each word is rendered as an inline span. When the source text changes we
 * reset progress and walk through the word list on an interval. The default
 * cadence is fast enough to feel like the words are materializing as the AI
 * voice speaks them — but it's purely visual; no real audio sync.
 *
 *   - `text`           the string to reveal
 *   - `wordIntervalMs` ms between successive words (default 65ms)
 *   - `instant`        bypass the animation (e.g. for resumed sessions)
 *   - `onComplete`     fires once all words are shown
 */
export function TypewriterText({
  text,
  className = "",
  wordIntervalMs = 65,
  instant = false,
  onComplete,
}: {
  text: string;
  className?: string;
  wordIntervalMs?: number;
  instant?: boolean;
  onComplete?: () => void;
}) {
  // Split on whitespace but keep the trailing whitespace attached so the
  // final string preserves spacing/line breaks exactly.
  const tokens = useMemo(() => {
    if (!text) return [];
    return text.match(/\S+\s*/g) ?? [];
  }, [text]);

  const [count, setCount] = useState(instant ? tokens.length : 0);
  const completedRef = useRef(false);

  useEffect(() => {
    completedRef.current = false;
    if (instant) {
      setCount(tokens.length);
      if (tokens.length > 0) {
        completedRef.current = true;
        onComplete?.();
      }
      return;
    }
    setCount(0);
    if (tokens.length === 0) return;

    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setCount(i);
      if (i >= tokens.length) {
        window.clearInterval(id);
        if (!completedRef.current) {
          completedRef.current = true;
          onComplete?.();
        }
      }
    }, Math.max(20, wordIntervalMs));

    return () => {
      window.clearInterval(id);
    };
    // We intentionally exclude `onComplete` from deps — restarting the
    // typewriter every time the parent rerenders would be jarring.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokens, wordIntervalMs, instant]);

  return (
    <span className={className}>
      {tokens.slice(0, count).map((tok, i) => (
        <span
          key={i}
          className="tw-word"
          style={{ animationDelay: `${Math.min(i, 8) * 10}ms` }}
        >
          {tok}
        </span>
      ))}
      <style jsx>{`
        .tw-word {
          display: inline;
          opacity: 0;
          animation: tw-in 220ms ease-out forwards;
        }
        @keyframes tw-in {
          from {
            opacity: 0;
            transform: translateY(2px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .tw-word {
            opacity: 1;
            animation: none;
          }
        }
      `}</style>
    </span>
  );
}
