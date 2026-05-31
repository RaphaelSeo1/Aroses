"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Reveals text CHARACTER-by-character (like a live typing stream), matching
 * the feel of the course-generation build.
 *
 * When the source text grows by APPENDING (the new text starts with the
 * previously-shown text) the already-revealed characters stay put and the
 * animation simply continues into the new suffix. When the text changes
 * completely it resets and types out the new content from the start.
 *
 * The transcript in Mentored Learning is audio-gated — the parent reveals a
 * whole spoken chunk at once when its audio starts. To keep the typing fluid
 * AND in sync with the voice, we "catch up" (reveal several characters per
 * tick) when far behind, then slow to one character at a time near the end.
 *
 * Rendering is a single growing text node (no per-character spans), which is
 * cheap — important since this runs alongside the voice/visuals.
 *
 *   - `text`            the string to reveal
 *   - `charIntervalMs`  ms between ticks (default 9, ~2 chars/tick)
 *   - `wordIntervalMs`  legacy prop, accepted for compatibility (unused)
 *   - `instant`         bypass the animation (e.g. for resumed sessions)
 *   - `onComplete`      fires once all characters are shown
 */
export function TypewriterText({
  text,
  className = "",
  charIntervalMs = 9,
  // Accepted for backwards-compatibility with existing call sites; pacing is
  // now uniform and character-based, so this no longer drives the speed.
  wordIntervalMs: _wordIntervalMs,
  instant = false,
  onComplete,
}: {
  text: string;
  className?: string;
  charIntervalMs?: number;
  wordIntervalMs?: number;
  instant?: boolean;
  onComplete?: () => void;
}) {
  const full = text ?? "";
  const [count, setCount] = useState(instant ? full.length : 0);
  const completedRef = useRef(false);
  const prevTextRef = useRef<string>("");
  // Track progress via a ref so the interval callback can read/advance it
  // without `count` being an effect dependency (which would restart the
  // interval on every tick).
  const countRef = useRef<number>(instant ? full.length : 0);

  useEffect(() => {
    const prev = prevTextRef.current;
    const isAppend = full.length > prev.length && full.startsWith(prev);
    prevTextRef.current = full;
    completedRef.current = false;

    if (instant || full.length === 0) {
      countRef.current = full.length;
      setCount(full.length);
      if (full.length > 0) {
        completedRef.current = true;
        onComplete?.();
      }
      return;
    }

    // On an append, keep the characters already revealed; on a true content
    // change, start typing from the beginning.
    let i = isAppend ? Math.min(countRef.current, full.length) : 0;
    countRef.current = i;
    setCount(i);

    if (i >= full.length) {
      completedRef.current = true;
      onComplete?.();
      return;
    }

    // Drive the reveal off requestAnimationFrame (same approach as the
    // course-generation build) so each step actually paints — setInterval
    // tends to batch several ticks into one frame, which looks stuttery.
    let cancelled = false;
    let frameId = 0;
    const stepDelay = Math.max(6, charIntervalMs);
    const CHARS_PER_TICK = 2;
    let lastEmit = performance.now();

    const run = (now: number) => {
      if (cancelled) return;
      const elapsed = now - lastEmit;
      if (elapsed >= stepDelay) {
        const ticks = Math.max(1, Math.floor(elapsed / stepDelay));
        lastEmit += ticks * stepDelay;
        i = Math.min(full.length, i + ticks * CHARS_PER_TICK);
        countRef.current = i;
        setCount(i);
      }
      if (i < full.length) {
        frameId = requestAnimationFrame(run);
      } else if (!completedRef.current) {
        completedRef.current = true;
        onComplete?.();
      }
    };
    frameId = requestAnimationFrame(run);

    return () => {
      cancelled = true;
      cancelAnimationFrame(frameId);
    };
    // `onComplete` intentionally excluded — restarting the typewriter on every
    // parent rerender would be jarring.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [full, charIntervalMs, instant]);

  const done = count >= full.length;

  return (
    <span className={className}>
      {full.slice(0, count)}
      {!done && full.length > 0 ? (
        <span className="tw-caret" aria-hidden="true" />
      ) : null}
      <style jsx>{`
        .tw-caret {
          display: inline-block;
          width: 2px;
          height: 1em;
          margin-left: 2px;
          vertical-align: text-bottom;
          background: currentColor;
          opacity: 0.55;
          animation: tw-blink 1s steps(2, start) infinite;
        }
        @keyframes tw-blink {
          50% {
            opacity: 0;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .tw-caret {
            animation: none;
          }
        }
      `}</style>
    </span>
  );
}
