/**
 * Validates `next` query values so redirects stay same-origin and internal.
 * Returns pathname + search (e.g. `/explore?id=1`) or null.
 */
export function parseSafeInternalNext(raw: string | null): string | null {
  if (!raw) return null;
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (!decoded.startsWith("/") || decoded.startsWith("//")) return null;
  if (decoded.includes("://") || decoded.includes("\\")) return null;
  const pathOnly = decoded.split("?")[0];
  if (pathOnly === "/login" || pathOnly === "/signup") return null;
  return decoded;
}
