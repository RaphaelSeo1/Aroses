export const DEFAULT_SUPABASE_TIMEOUT_MS = 5_000;
/** Longer bound for auth/session lookups in proxy and page shells. */
export const AUTH_SUPABASE_TIMEOUT_MS = 12_000;
/**
 * Badge / due-count widgets must fail open quickly. A 5s auth wait on every
 * homepage load is user-visible stall; zeros are better than holding the UI.
 */
export const WIDGET_SUPABASE_TIMEOUT_MS = 1_000;

export function isSupabaseTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /exceeded \d+ms/i.test(error.message);
}

/**
 * Bound each server-side Supabase HTTP request so an upstream stall cannot hold
 * a Proxy or Route Handler open until the platform kills it.
 */
export function createBoundedSupabaseFetch(
  timeoutMs = DEFAULT_SUPABASE_TIMEOUT_MS
): typeof fetch {
  return async (input, init) => {
    const controller = new AbortController();
    const callerSignal = init?.signal;
    const abortFromCaller = () => controller.abort(callerSignal?.reason);

    if (callerSignal?.aborted) {
      abortFromCaller();
    } else {
      callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
    }

    const timer = setTimeout(() => {
      controller.abort(
        new Error(`Supabase request exceeded ${timeoutMs}ms`)
      );
    }, timeoutMs);

    try {
      return await fetch(input, {
        ...init,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", abortFromCaller);
    }
  };
}

/**
 * Retry once on bounded-fetch timeout so a single slow auth hop does not 503
 * the whole app shell.
 */
export function createBoundedSupabaseFetchWithRetry(
  timeoutMs = DEFAULT_SUPABASE_TIMEOUT_MS,
  maxRetries = 1
): typeof fetch {
  const fetchOnce = createBoundedSupabaseFetch(timeoutMs);
  return async (input, init) => {
    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fetchOnce(input, init);
      } catch (error) {
        lastError = error;
        if (!isSupabaseTimeoutError(error) || attempt >= maxRetries) {
          throw error;
        }
        await new Promise((resolve) =>
          setTimeout(resolve, 150 * (attempt + 1))
        );
      }
    }
    throw lastError;
  };
}
