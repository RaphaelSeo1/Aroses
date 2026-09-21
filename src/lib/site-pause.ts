import { isAppAdminEnvUser } from "./app-admin-env.ts";

/**
 * Public pause. Defaults on so a deploy closes the product without a new
 * Vercel variable. Set `SITE_PAUSED=0` (mirrored to `NEXT_PUBLIC_SITE_PAUSED`
 * at build time) and redeploy to reopen.
 *
 * The founder account in `BUILT_IN_APP_ADMIN_EMAILS` is always allowed through.
 */
export function isSitePaused(): boolean {
  const raw = (
    process.env.NEXT_PUBLIC_SITE_PAUSED ??
    process.env.SITE_PAUSED ??
    "1"
  )
    .trim()
    .toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off";
}

/** Routes that must answer while the product is closed. */
export function isSitePauseExemptPath(pathname: string): boolean {
  if (pathname === "/paused" || pathname.startsWith("/paused/")) return true;
  if (pathname === "/login" || pathname.startsWith("/login/")) return true;
  if (pathname === "/reset-password" || pathname.startsWith("/reset-password/")) {
    return true;
  }
  if (
    pathname === "/api/billing/webhook" ||
    pathname.startsWith("/api/billing/webhook/")
  ) {
    return true;
  }
  return false;
}

export function sitePauseAllowsUser(
  user: { id: string; email?: string | null } | null | undefined
): boolean {
  if (!isSitePaused()) return true;
  return Boolean(user && isAppAdminEnvUser(user));
}
