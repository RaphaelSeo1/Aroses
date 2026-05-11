/**
 * Optional school / organization auth policy (configure via env).
 *
 * **Google Workspace “school login”**
 * Set `NEXT_PUBLIC_SCHOOL_GOOGLE_HD` to your institution’s Google hosted domain
 * (e.g. `myschool.edu`). `signInWithOAuth` passes Google’s `hd` hint so the account
 * chooser targets that organization — users use the same Google sign-in your school
 * already uses.
 *
 * **Who may hold a session**
 * Set `ALLOWED_AUTH_EMAIL_DOMAINS` or `NEXT_PUBLIC_ALLOWED_AUTH_EMAIL_DOMAINS` to a
 * comma-separated list (no `@`): `berkeley.edu,mail.berkeley.edu`. If non-empty,
 * middleware signs out anyone whose email does not match. Prefer the non-public
 * `ALLOWED_AUTH_EMAIL_DOMAINS` in production if you don’t want the list in client JS.
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
