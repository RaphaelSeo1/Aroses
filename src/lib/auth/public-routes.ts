/**
 * Paths guests may hit without signing in. Everything else in the product
 * (notes, review, courses, tutor, live notes, dashboard) requires an account.
 *
 * Proxy matcher already skips `/intro`, `/help`, `/legal`, `/auth`, and static
 * assets; those are listed here so page-level and test logic stay aligned.
 */

const PUBLIC_EXACT = new Set([
  "/intro",
  "/help",
  "/login",
  "/signup",
  "/reset-password",
  "/brand",
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
