import { isPaidTier, type PlanTier } from "./plans.ts";
import { parseTourDemoCookie } from "../product-tour/tour-demo-cookie.ts";

const PAID_STATUSES = new Set(["active", "trialing", "past_due"]);

export type PaidAccessSnapshot = {
  tier?: string | null;
  status?: string | null;
  adminGranted?: boolean | null;
};

/** True when the user may use the product (not the unpaid/free default). */
export function hasPaidProductAccess(sub: PaidAccessSnapshot | null | undefined): boolean {
  const tier = (sub?.tier ?? "free").toLowerCase() as PlanTier;
  const status = (sub?.status ?? "inactive").toLowerCase();
  if (sub?.adminGranted && isPaidTier(tier)) return true;
  if (!isPaidTier(tier)) return false;
  return PAID_STATUSES.has(status);
}

/**
 * Signed-in users without a paid plan may still hit onboarding, billing,
 * help, and an in-progress product tour — nothing else.
 */
export function isUnpaidProductAllowedPath(
  pathname: string,
  search = ""
): boolean {
  if (pathname === "/onboarding" || pathname.startsWith("/onboarding/")) {
    return true;
  }
  if (
    pathname === "/dashboard/profile" ||
    pathname.startsWith("/dashboard/profile/")
  ) {
    return true;
  }
  if (
    pathname === "/dashboard/billing" ||
    pathname.startsWith("/dashboard/billing/")
  ) {
    return true;
  }
  if (pathname === "/help" || pathname.startsWith("/help/")) return true;
  if (pathname.startsWith("/legal")) return true;
  if (pathname.startsWith("/api/")) return true;

  const raw = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(raw);
  if (params.get("tour") === "1" || params.get("setupUpgrade") === "1") {
    return true;
  }
  return false;
}

export function unpaidUserHasTourAccess(cookieValue: string | null | undefined): boolean {
  return parseTourDemoCookie(cookieValue) != null;
}

export const PAID_ACCESS_REDIRECT = "/dashboard/profile?tab=billing";
