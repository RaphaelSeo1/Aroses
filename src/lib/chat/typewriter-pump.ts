/**
 * Character-by-character reveal for student-facing chat bubbles.
 *
 * The network stream (SSE or a finished JSON reply) can run ahead; this pump
 * paints letters at a steady ~68 cps and speeds up when the backlog is large
 * so a long model burst never looks like a paragraph dump. It does not block
 * the reader — call it in parallel with the fetch loop.
 */

export const REPLY_TICK_MS = 16;
export const REPLY_CPS = 68;
export const REPLY_CPS_MID = 110;
export const REPLY_CPS_CATCHUP = 170;

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function typewriterStepChars(
  leftoverLen: number,
  tickMs: number = REPLY_TICK_MS
): number {
  const cps =
    leftoverLen > 320
      ? REPLY_CPS_CATCHUP
      : leftoverLen > 90
        ? REPLY_CPS_MID
        : REPLY_CPS;
  return Math.max(1, Math.round((cps * tickMs) / 1000));
}

export type TypewriterPumpOptions = {
  getSource: () => string;
  reveal: (visible: string) => void;
  isDone: () => boolean;
  isCancelled?: () => boolean;
  /** Voice / TTS path: show the full source immediately. */
  skipAnimation?: () => boolean;
  onTick?: () => void;
};

export async function pumpTypewriterReply(
  opts: TypewriterPumpOptions
): Promise<void> {
  let revealed = 0;
  while (!opts.isCancelled?.()) {
    opts.onTick?.();
    const source = opts.getSource();
    if (revealed > source.length) {
      revealed = source.length;
      opts.reveal(source);
    }
    const leftover = source.slice(revealed);
    if (opts.skipAnimation?.()) {
      revealed = source.length;
      opts.reveal(source);
      if (opts.isDone()) break;
      await sleep(REPLY_TICK_MS);
      continue;
    }
    if (!leftover) {
      if (opts.isDone()) break;
      await sleep(REPLY_TICK_MS);
      continue;
    }
    const step = typewriterStepChars(leftover.length);
    revealed += Math.min(step, leftover.length);
    opts.reveal(source.slice(0, revealed));
    await sleep(REPLY_TICK_MS);
  }
}

/** Type out a finished string (JSON chat replies). */
export async function typewriteKnownText(
  full: string,
  reveal: (partial: string) => void,
  opts?: { signal?: AbortSignal; skipAnimation?: boolean }
): Promise<void> {
  if (!full || opts?.skipAnimation) {
    reveal(full);
    return;
  }
  if (opts?.signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
  let cancelled = false;
  const onAbort = () => {
    cancelled = true;
  };
  opts?.signal?.addEventListener("abort", onAbort);
  try {
    await pumpTypewriterReply({
      getSource: () => full,
      reveal,
      isDone: () => true,
      isCancelled: () => cancelled || opts?.signal?.aborted === true,
    });
  } finally {
    opts?.signal?.removeEventListener("abort", onAbort);
  }
  if (opts?.signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
}
