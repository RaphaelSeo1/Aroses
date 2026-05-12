/**
 * Optional school / organization auth policy (configure via env).
 *
 * **Google Workspace “school login” (optional)**
 * To restrict the Google account picker to one Workspace domain, render
 * `GoogleSignInButton` with `restrictToSchoolWorkspace` and optionally set
 * `NEXT_PUBLIC_SCHOOL_GOOGLE_HD` — the button passes Google’s `hd` hint only in
 * that mode. By default the button does **not** send `hd`, so personal Gmail and
 * any Google account work.
 *
 * **Who may hold a session (optional hard gate)**
 * Set `ALLOWED_AUTH_EMAIL_DOMAINS` or `NEXT_PUBLIC_ALLOWED_AUTH_EMAIL_DOMAINS` to a
 * comma-separated list (no `@`). When **enforcement** is on (see below), middleware
 * signs out anyone whose email does not match.
 *
 * **`AUTH_EMAIL_DOMAIN_ALLOWLIST_ENFORCED`**
 * - `false` or `0` — ignore the domain list for sign-in gating (any email allowed).
 * - `true` or `1` — enforce the list when it is non-empty.
 * - **Unset** — enforce **if and only if** the domain list is non-empty (legacy default).
 *
 * **Soft “preferred school Google” copy (not a rule)**
 * By default, login/signup show a short neutral line (no domain names). Override with
 * `NEXT_PUBLIC_SCHOOL_GOOGLE_PREFERRED_HINT`, or set it to `-` to hide the line entirely.
 *
 * **Client components:** `ALLOWED_AUTH_EMAIL_DOMAINS` is not available in the browser
 * bundle — pass the result of `parseAllowedAuthEmailDomains()` from a Server
 * Component as props, or duplicate the list in `NEXT_PUBLIC_ALLOWED_AUTH_EMAIL_DOMAINS`
 * for UI-only hints.
 *
 * **Disable email/password**
 * `NEXT_PUBLIC_SCHOOL_ONLY_NO_EMAIL_PASSWORD=true` hides email/password forms.
 *
 * **Microsoft / SAML**
 * Configure those providers in Supabase separately; keep domains aligned here.
 */

const DOMAIN_PART =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

export function getSchoolGoogleHostedDomain(): string | undefined {
  const raw = process.env.NEXT_PUBLIC_SCHOOL_GOOGLE_HD?.trim().toLowerCase();
  if (!raw || !DOMAIN_PART.test(raw)) return undefined;
  return raw;
}

export function parseAllowedAuthEmailDomains(): string[] {
  const raw =
    process.env.ALLOWED_AUTH_EMAIL_DOMAINS?.trim() ||
    process.env.NEXT_PUBLIC_ALLOWED_AUTH_EMAIL_DOMAINS?.trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0 && DOMAIN_PART.test(s));
}

/**
 * When true, middleware and login/signup may reject non-matching emails.
 * @see module doc for `AUTH_EMAIL_DOMAIN_ALLOWLIST_ENFORCED`
 */
export function isAuthEmailDomainAllowlistEnforced(): boolean {
  const raw =
    process.env.AUTH_EMAIL_DOMAIN_ALLOWLIST_ENFORCED?.trim().toLowerCase();
  if (raw === "false" || raw === "0") return false;
  if (raw === "true" || raw === "1") {
    return parseAllowedAuthEmailDomains().length > 0;
  }
  return parseAllowedAuthEmailDomains().length > 0;
}

const DEFAULT_SCHOOL_GOOGLE_PREFERRED_HINT =
  "School or institutional Google is preferred if you have one — personal Gmail works too.";

/** Friendly copy on auth pages — not enforced. */
export function getSchoolGooglePreferredHint(): string {
  const raw = process.env.NEXT_PUBLIC_SCHOOL_GOOGLE_PREFERRED_HINT?.trim();
  if (raw === "-" || raw === "none") return "";
  if (raw) return raw;
  return DEFAULT_SCHOOL_GOOGLE_PREFERRED_HINT;
}

export function emailMatchesAllowedDomains(
  email: string | null | undefined,
  domains: string[]
): boolean {
  if (!email || domains.length === 0) return domains.length === 0;
  const lower = email.trim().toLowerCase();
  return domains.some((d) => lower.endsWith(`@${d}`));
}

export function isSchoolOnlyNoEmailPassword(): boolean {
  return (
    process.env.NEXT_PUBLIC_SCHOOL_ONLY_NO_EMAIL_PASSWORD?.trim().toLowerCase() ===
    "true"
  );
}

export function isValidWorkspaceHostedDomain(hd: string): boolean {
  return DOMAIN_PART.test(hd.trim().toLowerCase());
}

export function schoolEmailPolicyUserMessage(allowedDomains: string[]): string {
  if (allowedDomains.length === 0) return "";
  if (allowedDomains.length === 1) {
    return `Only school accounts ending in @${allowedDomains[0]} are allowed.`;
  }
  return `Only school accounts on these domains are allowed: ${allowedDomains.map((d) => `@${d}`).join(", ")}.`;
}
