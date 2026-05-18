"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Reveals a block of text word-by-word with a soft fade-in.
 *
 * Each word is rendered as an inline span. When the source text grows by
 * APPENDING (the new text starts with the previously-shown text), the
 * already-revealed words stay put and only the new suffix animates in.
 * When the text changes completely (different content), the component
 * resets and walks through the new word list on an interval.
 *
 * This append-aware behavior lets the streamed Mentored transcript add
 * sentence after sentence — synced to audio playback — without the prior
 * text re-animating from the start every time.
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
  // We track the previous text + previously-revealed count via refs
  // so the effect can decide whether this update is an APPEND (extend
  // the existing animation, carry over progress) or a REPLACE (reset
  // and re-animate from word 0). Using refs avoids putting `count` in
  // the effect deps, which would restart the interval on every tick.
  const prevTextRef = useRef<string>("");
  const revealedRef = useRef<number>(instant ? tokens.length : 0);

  useEffect(() => {
    const prev = prevTextRef.current;
    const isAppend = text.length > prev.length && text.startsWith(prev);
    prevTextRef.current = text;

    completedRef.current = false;
    if (instant) {
      revealedRef.current = tokens.length;
      setCount(tokens.length);
      if (tokens.length > 0) {
        completedRef.current = true;
        onComplete?.();
      }
      return;
    }
    if (tokens.length === 0) {
      revealedRef.current = 0;
      setCount(0);
      return;
    }

    // On a true reset (different content, not an append), start over.
    // On an append, keep the already-revealed words.
    let i = isAppend ? Math.min(revealedRef.current, tokens.length) : 0;
    revealedRef.current = i;
    setCount(i);

    if (i >= tokens.length) {
      // Already fully revealed (rare — e.g. fast subsequent updates).
      if (!completedRef.current) {
        completedRef.current = true;
        onComplete?.();
      }
      return;
    }
    const id = window.setInterval(() => {
      i += 1;
      revealedRef.current = i;
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
  }, [tokens, text, wordIntervalMs, instant]);

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
