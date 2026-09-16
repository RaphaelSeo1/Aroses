/** Client abort slightly above the widget auth bound so a 200 zeros can land. */
export const WIDGET_CLIENT_TIMEOUT_MS = 2_000;

/** Review dashboard needs real due rows, not a fail-open empty shell. */
export const REVIEW_DUE_COUNTS_CLIENT_TIMEOUT_MS = 15_000;

type InflightEntry = {
  promise: Promise<unknown>;
  /** Stretch the abort deadline when a longer waiter joins the same URL. */
  extendTimeout: (timeoutMs: number) => void;
};

const inflight = new Map<string, InflightEntry>();

/**
 * GET JSON, sharing one in-flight request per URL so header + banner + avatar
 * menu (and focus/poll) do not stampede the same badge endpoint.
 *
 * When a second caller joins with a longer timeout (e.g. Review dashboard), the
 * shared abort deadline is extended so the nav badge's short fail-open window
 * does not cancel the page that needs accurate counts.
 */
export function sharedJsonGet<T>(
  url: string,
  timeoutMs = WIDGET_CLIENT_TIMEOUT_MS
): Promise<T> {
  const existing = inflight.get(url);
  if (existing) {
    existing.extendTimeout(timeoutMs);
    return existing.promise as Promise<T>;
  }

  const controller = new AbortController();
  let deadlineAt = Date.now() + timeoutMs;
  let timer = setTimeout(() => {
    controller.abort(new Error(`Widget request exceeded ${timeoutMs}ms`));
  }, timeoutMs);

  const extendTimeout = (nextTimeoutMs: number) => {
    const nextDeadline = Date.now() + nextTimeoutMs;
    if (nextDeadline <= deadlineAt || controller.signal.aborted) return;
    deadlineAt = nextDeadline;
    clearTimeout(timer);
    timer = setTimeout(() => {
      controller.abort(
        new Error(`Widget request exceeded ${nextTimeoutMs}ms`)
      );
    }, nextTimeoutMs);
  };

  const request: Promise<T> = (async () => {
    try {
      const res = await fetch(url, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`${url} ${res.status}`);
      }
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
      inflight.delete(url);
    }
  })();

  inflight.set(url, { promise: request, extendTimeout });
  return request;
}

export function clearSharedJsonGetForTests(): void {
  inflight.clear();
}
