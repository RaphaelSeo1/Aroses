const DEFAULT_SUPABASE_TIMEOUT_MS = 5_000;

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
