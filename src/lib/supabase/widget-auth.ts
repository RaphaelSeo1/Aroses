import {
  isMissingAuthSessionError,
  isSupabaseTransportError,
} from "../auth/public-routes.ts";

export type WidgetAuthDecision = "proceed" | "empty" | "unavailable";

/**
 * Nav badge endpoints should not 401/503 the chrome. Guests, missing sessions,
 * and upstream stalls all fail open to empty counts. Only unexpected auth
 * errors stay 503.
 */
export function decideWidgetAuth(
  user: { id: string } | null,
  authError: {
    message?: string;
    name?: string;
    code?: string;
  } | null | undefined
): WidgetAuthDecision {
  if (authError && !isMissingAuthSessionError(authError)) {
    return isSupabaseTransportError(authError) ? "empty" : "unavailable";
  }
  if (!user) return "empty";
  return "proceed";
}

/** Resolve `promise` or return null when it exceeds `timeoutMs` / throws. */
export async function firstResolvedOrNull<T>(
  promise: Promise<T>,
  timeoutMs: number
): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } catch {
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
