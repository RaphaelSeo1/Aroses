/**
 * Canonical origin for auth email links (`emailRedirectTo`, etc.).
 *
 * **Supabase (fixes `{"error":"requested path is invalid"}` on verify):**
 * 1. Dashboard → Authentication → URL Configuration
 * 2. Set **Site URL** to your app (e.g. `https://aroses.vercel.app`), not the
 *    `*.supabase.co` API host.
 * 3. Under **Redirect URLs**, add at least:
 *    - `https://aroses.vercel.app/auth/callback` (or `https://aroses.vercel.app/**`)
 *    - `http://localhost:3000/auth/callback` for local dev
 *
 * Set `NEXT_PUBLIC_SITE_URL` to that same origin (no trailing slash) so
 * confirmation links always match what you allowlisted (avoids www vs apex mismatches).
 */
export function getPublicSiteOrigin(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "");
  if (raw && /^https?:\/\//i.test(raw)) {
    return raw;
  }
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return "";
}
