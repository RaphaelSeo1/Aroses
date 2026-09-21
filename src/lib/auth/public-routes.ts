/**
 * Paths guests may hit without signing in. Everything else in the product
 * (notes, review, courses, tutor, live notes, dashboard) requires an account.
 *
 * Proxy matcher skips `/auth` and static assets. `/intro`, `/help`, and `/legal`
 * stay on this list so page-level checks match, but the site pause redirects
 * them to `/paused` while the product is closed.
 */

const PUBLIC_EXACT = new Set([
  "/intro",
  "/help",
  "/login",
  "/signup",
  "/reset-password",
  "/brand",
  "/paused",
]);

const PUBLIC_PREFIXES = [
  "/intro/",
  "/help/",
  "/legal",
  "/auth",
  "/share",
  "/login/",
  "/signup/",
  "/reset-password/",
  "/brand/",
] as const;

export function isPublicUnauthenticatedPath(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  return PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix.replace(/\/$/, "") || pathname.startsWith(prefix)
  );
}

/** Marketing home for guests; product home (`/`) is authenticated. */
export function unauthenticatedHomePath(): string {
  return "/intro";
}

/** Where to send guests who tried to open a product route. */
export function unauthenticatedProductEntryPath(): string {
  return "/signup";
}

/**
 * Login redirect `next` for `/` and `/dashboard` should not bounce returning
 * users into a nested dashboard URL when they only opened the hub.
 */
export function nextPathForUnauthenticated(pathname: string, fullPath: string): string {
  if (pathname === "/" || pathname === "/dashboard" || pathname === "/dashboard/") {
    return "/";
  }
  return fullPath;
}

/**
 * `getUser()` reports a missing cookie/session as an error in some @supabase/ssr
 * versions. That is a logged-out guest, not an auth outage — keep 503 for
 * timeouts and upstream failures only.
 */
export function isMissingAuthSessionError(error: {
  message?: string;
  name?: string;
  code?: string;
} | null | undefined): boolean {
  if (!error) return false;
  const msg = error.message ?? "";
  const name = error.name ?? "";
  const code = error.code ?? "";
  return (
    /auth session missing/i.test(msg) ||
    name === "AuthSessionMissingError" ||
    code === "session_not_found"
  );
}

/** Upstream stall or outage — not a missing session. Prefer graceful degradation over 503. */
export function isSupabaseTransportError(error: {
  message?: string;
  name?: string;
  code?: string;
} | null | undefined): boolean {
  if (!error || isMissingAuthSessionError(error)) return false;
  const msg = error.message ?? "";
  const name = error.name ?? "";
  return (
    /exceeded \d+ms/i.test(msg) ||
    /fetch failed/i.test(msg) ||
    /network/i.test(msg) ||
    /timeout/i.test(msg) ||
    /502|503|504|522/i.test(msg) ||
    name === "AbortError"
  );
}

export function isSupabaseTransportFailure(error: unknown): boolean {
  if (!error) return false;
  if (typeof error === "object" && error !== null && "message" in error) {
    return isSupabaseTransportError(
      error as { message?: string; name?: string; code?: string }
    );
  }
  if (error instanceof Error) {
    return isSupabaseTransportError(error);
  }
  return /exceeded \d+ms/i.test(String(error));
}
