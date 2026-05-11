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
 * **Google sign-in:** Authentication → Providers → Google — paste Client ID and
 * Secret from [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
 * (OAuth client type “Web application”). Under **Authorized redirect URIs**, add
 * `https://<your-project-ref>.supabase.co/auth/v1/callback` (Supabase shows the
 * exact URL in the provider settings). No special partnership with Google is
 * required for standard OAuth. Also keep your app URLs in Supabase → URL
 * Configuration → Redirect URLs as documented above.
 *
 * Set `NEXT_PUBLIC_SITE_URL` to that same origin (no trailing slash) so
 * confirmation links always match what you allowlisted (avoids www vs apex mismatches).
 *
 * **Local development:** OAuth and client-side `emailRedirectTo` use
 * `getBrowserAuthOrigin()` so sign-in returns to **localhost** even when
 * `NEXT_PUBLIC_SITE_URL` points at production.
 */
export function getBrowserAuthOrigin(): string {
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "");
  if (raw && /^https?:\/\//i.test(raw)) {
    return raw;
  }
  return "";
}

/** Canonical site URL when you need production origin outside the browser (e.g. emails). */
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
