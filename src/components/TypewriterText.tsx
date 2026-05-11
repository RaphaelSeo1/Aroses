"use client";

import { useEffect, useState } from "react";

export type TypewriterMode = "chars" | "words";

export type UseTypewriterStringOptions = {
  mode?: TypewriterMode;
  charDelayMs?: number;
  /** Characters appended per step when `mode` is `"chars"`. */
  charsPerTick?: number;
  wordDelayMs?: number;
  /** At or below this character length, show the full string immediately (no clock). Use `0` so only an empty string is instant. */
  instantBelow?: number;
};

/**
 * Progressive reveal for streaming-style UI. Uses `requestAnimationFrame` so each
 * step can paint (React + `setInterval` often batch many ticks into one frame).
 */
export function useTypewriterString(
  text: string,
  {
    mode = "chars",
    charDelayMs = 9,
    charsPerTick = 2,
    wordDelayMs = 26,
    instantBelow = 160,
  }: UseTypewriterStringOptions = {}
): string {
  const [shown, setShown] = useState("");

  useEffect(() => {
    if (!text) {
      setShown("");
      return;
    }
    if (text.length <= instantBelow) {
      setShown(text);
      return;
    }

    let cancelled = false;
    let frameId = 0;
    setShown("");

    if (mode === "words") {
      const parts = text.split(/(\s+)/);
      let wi = 0;
      let lastEmit = performance.now();

      const tick = (now: number) => {
        if (cancelled) return;
        if (wi < parts.length && now - lastEmit >= wordDelayMs) {
          const jumps = Math.min(
            parts.length - wi,
            Math.max(1, Math.floor((now - lastEmit) / wordDelayMs))
          );
          lastEmit += jumps * wordDelayMs;
          wi += jumps;
          setShown(parts.slice(0, wi).join(""));
        }
        if (wi < parts.length) {
          frameId = requestAnimationFrame(tick);
        }
      };
      frameId = requestAnimationFrame(tick);
      return () => {
        cancelled = true;
        cancelAnimationFrame(frameId);
      };
    }

    let i = 0;
    let lastEmit = performance.now();

    const run = (now: number) => {
      if (cancelled) return;
      if (i >= text.length) return;
      const elapsed = now - lastEmit;
      if (elapsed >= charDelayMs) {
        const jumps = Math.min(
          Math.ceil((text.length - i) / charsPerTick),
          Math.max(1, Math.floor(elapsed / charDelayMs))
        );
        lastEmit += jumps * charDelayMs;
        i = Math.min(i + jumps * charsPerTick, text.length);
        setShown(text.slice(0, i));
      }
      if (i < text.length) {
        frameId = requestAnimationFrame(run);
      }
    };
    frameId = requestAnimationFrame(run);

    return () => {
      cancelled = true;
      cancelAnimationFrame(frameId);
    };
  }, [text, mode, charDelayMs, charsPerTick, wordDelayMs, instantBelow]);

  return shown;
}

type TypewriterTextProps = {
  text: string;
  className?: string;
} & UseTypewriterStringOptions;

/**
 * Reveals `text` progressively. Short strings skip animation when `text.length <= instantBelow`
 * (default ~160). Pass `instantBelow={0}` to animate any non-empty string.
 */
export function TypewriterText({
  text,
  className,
  mode = "chars",
  charDelayMs = 9,
  charsPerTick = 2,
  wordDelayMs = 26,
  instantBelow = 160,
}: TypewriterTextProps) {
  const shown = useTypewriterString(text, {
    mode,
    charDelayMs,
    charsPerTick,
    wordDelayMs,
    instantBelow,
  });
  return <span className={className}>{shown}</span>;
}
