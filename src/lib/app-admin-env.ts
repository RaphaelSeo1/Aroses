/**
 * Gate `/dashboard/admin` and the Admin nav link. Server-only env is enough for
 * middleware; use NEXT_PUBLIC_APP_ADMIN_USER_IDS for the client nav link (same UUIDs).
 *
 * Comma-separated auth user UUIDs. Optional: APP_ADMIN_EMAILS (comma-separated, case-insensitive).
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
  return parseEmailList(process.env.APP_ADMIN_EMAILS?.trim());
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
