/** Client abort slightly above the widget auth bound so a 200 zeros can land. */
export const WIDGET_CLIENT_TIMEOUT_MS = 2_000;

const inflight = new Map<string, Promise<unknown>>();

/**
 * GET JSON, sharing one in-flight request per URL so header + banner + avatar
 * menu (and focus/poll) do not stampede the same badge endpoint.
 */
export function sharedJsonGet<T>(
  url: string,
  timeoutMs = WIDGET_CLIENT_TIMEOUT_MS
): Promise<T> {
  const existing = inflight.get(url);
  if (existing) return existing as Promise<T>;

  const request: Promise<T> = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(new Error(`Widget request exceeded ${timeoutMs}ms`));
    }, timeoutMs);
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
    }
  })().finally(() => {
    inflight.delete(url);
  });

  inflight.set(url, request);
  return request;
}

export function clearSharedJsonGetForTests(): void {
  inflight.clear();
}
