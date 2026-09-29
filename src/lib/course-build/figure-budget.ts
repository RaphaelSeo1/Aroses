/** Time budget for the figure scan: every loop and long await checks it. */

export class OverBudget extends Error {
  constructor() {
    super("figure time budget used up");
    this.name = "OverBudget";
  }
}

export class FigureBudget {
  readonly deadlineAt: number;
  private readonly now: () => number;

  constructor(deadlineAt: number, now: () => number = Date.now) {
    this.deadlineAt = deadlineAt;
    this.now = now;
  }

  get expired(): boolean {
    return this.now() > this.deadlineAt;
  }

  remainingMs(): number {
    return Math.max(0, this.deadlineAt - this.now());
  }

  /** A budget ending when `share` of what is left here has passed. */
  portion(share: number): FigureBudget {
    return new FigureBudget(this.now() + this.remainingMs() * share, this.now);
  }

  /** Throws OverBudget past the deadline; a plain error when aborted. */
  check(signal?: AbortSignal): void {
    if (signal?.aborted) throw new Error("aborted");
    if (this.expired) throw new OverBudget();
  }

  /** Awaits a cancellable task (a pdfjs render), cancelling it when the budget runs out. */
  async within<T>(task: { promise: Promise<T>; cancel(): void }): Promise<T> {
    const stop = setTimeout(() => task.cancel(), this.remainingMs());
    try {
      return await task.promise;
    } catch (err) {
      if (this.expired) throw new OverBudget();
      throw err;
    } finally {
      clearTimeout(stop);
    }
  }
}

/** Lets timers, heartbeats and other requests run between CPU-heavy steps. */
export const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * Pages 1..total in bit-reversed order (for 46 pages: 1, 33, 17, 9, 41, 25,
 * …): every prefix is spread over the whole file, so a scan cut short is a
 * sample of it rather than just the first pages.
 */
export function spreadOrder(total: number): number[] {
  const bits = Math.max(1, Math.ceil(Math.log2(Math.max(2, total))));
  const out: number[] = [];
  for (let k = 0; k < 1 << bits; k++) {
    let r = 0;
    for (let b = 0; b < bits; b++) if (k & (1 << b)) r |= 1 << (bits - 1 - b);
    if (r < total) out.push(r + 1);
  }
  return out;
}

/**
 * Runs `work` for each item until the budget runs out, yielding between
 * items. Results emitted before the budget ran out are kept, including those
 * from an item cut off part-way. Other errors propagate.
 */
export async function eachWithinBudget<I, R>(
  items: readonly I[],
  budget: FigureBudget,
  signal: AbortSignal | undefined,
  work: (item: I, emit: (r: R) => void) => Promise<void>,
  opts: { stopWhen?: (results: R[]) => boolean } = {}
): Promise<{ results: R[]; processed: number; truncated: boolean }> {
  const results: R[] = [];
  let processed = 0;
  for (const item of items) {
    if (signal?.aborted) throw new Error("aborted");
    if (opts.stopWhen?.(results)) return { results, processed, truncated: true };
    if (budget.expired) return { results, processed, truncated: true };
    await yieldToEventLoop();
    processed++;
    try {
      await work(item, (r) => results.push(r));
    } catch (err) {
      if (err instanceof OverBudget) return { results, processed, truncated: true };
      throw err;
    }
  }
  return { results, processed, truncated: false };
}
