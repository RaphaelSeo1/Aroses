/**
 * Gate `/dashboard/admin` and the Admin nav link.
 *
 * Use comma-separated auth user UUIDs in `APP_ADMIN_USER_IDS` and/or
 * `NEXT_PUBLIC_APP_ADMIN_USER_IDS`. Emails: `APP_ADMIN_EMAILS` and/or
 * `NEXT_PUBLIC_APP_ADMIN_EMAILS`.
 *
 * On Vercel, **middleware runs on Edge** and often cannot read non-`NEXT_PUBLIC_`
 * variables from `.env`; `next.config.ts` mirrors the private vars into the
 * `NEXT_PUBLIC_*` keys at build time so the gate still works when you only set
 * `APP_ADMIN_USER_IDS` in project settings.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseUuidList(raw: string | undefined): Set<string> {
  const out = new Set<string>();
  if (!raw?.trim()) return out;
  for (const part of raw.split(",")) {
    const s = part.trim().toLowerCase();
    if (UUID_RE.test(s)) out.add(s);
  }
  return out;
}

function parseEmailList(raw: string | undefined): Set<string> {
  const out = new Set<string>();
  if (!raw?.trim()) return out;
  for (const part of raw.split(",")) {
    const s = part.trim().toLowerCase();
    if (s.length > 0) out.add(s);
  }
  return out;
}

export function getAppAdminUserIdSet(): Set<string> {
  const a = parseUuidList(process.env.APP_ADMIN_USER_IDS?.trim());
  const b = parseUuidList(process.env.NEXT_PUBLIC_APP_ADMIN_USER_IDS?.trim());
  return new Set([...a, ...b]);
}

export function getAppAdminEmailSet(): Set<string> {
  const a = parseEmailList(process.env.APP_ADMIN_EMAILS?.trim());
  const b = parseEmailList(process.env.NEXT_PUBLIC_APP_ADMIN_EMAILS?.trim());
  return new Set([...a, ...b]);
}

export function isAppAdminEnvUser(user: {
  id: string;
  email?: string | null;
}): boolean {
  const ids = getAppAdminUserIdSet();
  if (ids.has(user.id.trim().toLowerCase())) return true;
  const emails = getAppAdminEmailSet();
  const em = typeof user.email === "string" ? user.email.trim().toLowerCase() : "";
  if (em && emails.has(em)) return true;
  return false;
}

/** Use from Server Components (e.g. Explore) where client nav context may not reach the header. */
export function adminHubHrefForSessionUser(user: {
  id: string;
  email?: string | null;
}): string | undefined {
  return isAppAdminEnvUser(user) ? "/dashboard/admin" : undefined;
}
