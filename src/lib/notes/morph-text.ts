/**
 * Progressive string morph: delete leftover characters, then type new ones.
 * Used when Refine with Rose applies lesson edits into the live course view.
 *
 * Large rewrites (little shared prefix) skip the slow delete pass and type the
 * new text from empty so the open lesson feels like a live AI edit.
 */
export async function morphText(
  from: string,
  to: string,
  onFrame: (next: string) => void,
  opts?: { charDelayMs?: number; charsPerTick?: number; signal?: AbortSignal }
): Promise<void> {
  const charDelayMs = opts?.charDelayMs ?? 8;
  const charsPerTick = Math.max(1, opts?.charsPerTick ?? 2);
  const signal = opts?.signal;

  let prefixLen = 0;
  const max = Math.min(from.length, to.length);
  while (prefixLen < max && from[prefixLen] === to[prefixLen]) {
    prefixLen += 1;
  }

  const sleep = (ms: number) =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      const t = window.setTimeout(resolve, ms);
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(t);
          reject(new DOMException("Aborted", "AbortError"));
        },
        { once: true }
      );
    });

  const typeFrom = async (start: number) => {
    for (let i = start; i < to.length; i += charsPerTick) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const next = to.slice(0, Math.min(to.length, i + charsPerTick));
      onFrame(next);
      await sleep(charDelayMs);
    }
    onFrame(to);
  };

  const share =
    prefixLen / Math.max(from.length, to.length, 1);
  // AI rewrites rarely share a long prefix — typing the new body reads better.
  if (share < 0.35 && from.length > 48) {
    onFrame("");
    await sleep(charDelayMs);
    await typeFrom(0);
    return;
  }

  // Shrink from → common prefix (character deletion).
  for (let i = from.length; i > prefixLen; i -= charsPerTick) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const next = from.slice(0, Math.max(prefixLen, i - charsPerTick));
    onFrame(next);
    await sleep(charDelayMs);
  }
  onFrame(from.slice(0, prefixLen));

  await typeFrom(prefixLen);
}
