/** Split streamed model text into bounded visible typing ticks. */
export function chunkTypewriterText(text: string, charsPerTick: number): string[] {
  if (!text) return [];
  const size = Math.max(1, Math.floor(charsPerTick));
  const characters = Array.from(text);
  const chunks: string[] = [];
  for (let index = 0; index < characters.length; index += size) {
    chunks.push(characters.slice(index, index + size).join(""));
  }
  return chunks;
}

/** True when the page is backgrounded (timers are heavily throttled). */
export function isDocumentHidden(): boolean {
  return (
    typeof document !== "undefined" && document.visibilityState === "hidden"
  );
}

export type TypewriterSchedule = {
  /** Delay between typing ticks. 0 = flush immediately (background tab). */
  tickMs: number;
  charsPerTick: number;
};

/**
 * Pick typing pace for the live-notes pump.
 *
 * Background tabs throttle `setTimeout`/`setInterval` (often to ≥1s), so a
 * 30ms typewriter appears frozen. When hidden, flush the pending text in one
 * write instead of animating.
 */
export function chooseTypewriterSchedule(opts: {
  visibleTickMs: number;
  visibleCharsPerTick: number;
  /** Remaining characters to reveal; used as the flush size when hidden. */
  pendingChars: number;
  hidden?: boolean;
}): TypewriterSchedule {
  const hidden = opts.hidden ?? isDocumentHidden();
  if (hidden) {
    return {
      tickMs: 0,
      charsPerTick: Math.max(1, opts.pendingChars),
    };
  }
  return {
    tickMs: Math.max(0, opts.visibleTickMs),
    charsPerTick: Math.max(1, Math.floor(opts.visibleCharsPerTick)),
  };
}
