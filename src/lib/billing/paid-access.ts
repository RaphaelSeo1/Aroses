import { isPaidTier, type PlanTier } from "./plans.ts";
import { parseTourDemoCookie } from "../product-tour/tour-demo-cookie.ts";

const PAID_STATUSES = new Set(["active", "trialing", "past_due"]);

export type PaidAccessSnapshot = {
  tier?: string | null;
  status?: string | null;
  adminGranted?: boolean | null;
  /** `admin` | `checkin` | null. Check-in Plus expires at currentPeriodEnd. */
  grantSource?: string | null;
  currentPeriodEnd?: string | null;
};

export function isCheckInGrantExpired(
  sub: PaidAccessSnapshot | null | undefined,
  now: Date = new Date()
): boolean {
  if ((sub?.grantSource ?? "").toLowerCase() !== "checkin") return false;
  const tier = (sub?.tier ?? "free").toLowerCase() as PlanTier;
  if (!isPaidTier(tier)) return false;
  if (!sub?.currentPeriodEnd) return true;
  const end = new Date(sub.currentPeriodEnd);
  if (Number.isNaN(end.getTime())) return true;
  return end.getTime() <= now.getTime();
}

export function snapshotFromSubscriptionRow(
  data:
    | {
        tier?: string | null;
        status?: string | null;
        admin_granted?: boolean | null;
        grant_source?: string | null;
        current_period_end?: string | null;
      }
    | null
    | undefined
): PaidAccessSnapshot {
  return {
    tier: data?.tier ?? null,
    status: data?.status ?? null,
    adminGranted: Boolean(data?.admin_granted),
    grantSource: data?.grant_source ?? null,
    currentPeriodEnd: data?.current_period_end ?? null,
  };
}

const PAID_ACCESS_SELECTS = [
  "tier, status, admin_granted, grant_source, current_period_end",
  "tier, status, admin_granted, current_period_end",
  "tier, status, admin_granted",
  "tier, status",
] as const;

/** Load a billing snapshot, falling back if newer columns are not migrated yet. */
export async function fetchPaidAccessSnapshot(
  client: { from: (table: string) => unknown },
  userId: string
): Promise<PaidAccessSnapshot | null> {
  const table = client.from as (table: string) => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: string
      ) => {
        maybeSingle: () => Promise<{
          data: Record<string, unknown> | null;
          error: { message?: string } | null;
        }>;
      };
    };
  };
  for (const columns of PAID_ACCESS_SELECTS) {
    const { data, error } = await table("user_subscriptions")
      .select(columns)
      .eq("user_id", userId)
      .maybeSingle();
    if (!error) return snapshotFromSubscriptionRow(data);
    const msg = error.message ?? "";
    if (!/grant_source|admin_granted|current_period_end|schema cache/i.test(msg)) {
      return null;
    }
  }
  return null;
}

/** True when the user may use the product (not the unpaid/free default). */
export function hasPaidProductAccess(
  sub: PaidAccessSnapshot | null | undefined,
  now: Date = new Date()
): boolean {
  if (isCheckInGrantExpired(sub, now)) return false;
  const tier = (sub?.tier ?? "free").toLowerCase() as PlanTier;
  const status = (sub?.status ?? "inactive").toLowerCase();
  if (sub?.adminGranted && isPaidTier(tier)) return true;
  if (!isPaidTier(tier)) return false;
  return PAID_STATUSES.has(status);
}

export const OPEN_UPGRADE_EVENT = "aroses:upgrade";

export function requestUpgradePopup(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(OPEN_UPGRADE_EVENT));
}

export const PAID_PLAN_REQUIRED_CODE = "paid_plan_required";

/** Unpaid users should see the upgrade popup, not the billing settings page. */
export const UPGRADE_POPUP_PATH = "/?upgrade=1";

/** Stripe Checkout success return. Cancel still opens the upgrade popup. */
export function isStripeCheckoutSuccessStatus(
  status: string | null | undefined
): boolean {
  return status === "success";
}

export function isBillingSettingsPath(pathname: string, search = ""): boolean {
  if (pathname === "/dashboard/billing" || pathname.startsWith("/dashboard/billing/")) {
    return true;
  }
  if (
    pathname === "/dashboard/profile" ||
    pathname.startsWith("/dashboard/profile/")
  ) {
    const raw = search.startsWith("?") ? search.slice(1) : search;
    return new URLSearchParams(raw).get("tab") === "billing";
  }
  return false;
}

/** Unpaid users may not sit on Plans & billing unless Checkout just succeeded. */
export function unpaidBillingSettingsShouldRedirect(
  pathname: string,
  search = ""
): boolean {
  if (!isBillingSettingsPath(pathname, search)) return false;
  const raw = search.startsWith("?") ? search.slice(1) : search;
  return !isStripeCheckoutSuccessStatus(new URLSearchParams(raw).get("status"));
}

/** Feature routes unpaid users should not enter (client gate + link intercept). */
export function unpaidUserShouldBlockFeaturePath(
  pathname: string,
  search = ""
): boolean {
  if (isBillingSettingsPath(pathname, search)) {
    return unpaidBillingSettingsShouldRedirect(pathname, search);
  }
  return isPaidFeaturePath(pathname, search);
}

function isPathOrPrefix(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

/**
 * Client subscription lookup has not finished. Treat as unpaid for link
 * intercept so we never flash a feature; only redirect after a real unpaid
 * result so a paid user is not bounced home.
 */
export type PaidGateAccess = "unknown" | "unpaid" | "paid";

export function unpaidGateShouldIntercept(
  access: PaidGateAccess,
  tourRunning: boolean
): boolean {
  if (tourRunning) return false;
  return access !== "paid";
}

export function unpaidGateShouldRedirect(
  access: PaidGateAccess,
  tourRunning: boolean
): boolean {
  if (tourRunning) return false;
  return access === "unpaid";
}

/**
 * Routes that actually use the product (workspace, learn, tutor, study, quiz,
 * record, create, review, note editors, billing). Unpaid users may still
 * *view* hubs like Home, Notes, Explore, and the courses list.
 */
export function isPaidFeaturePath(pathname: string, search = ""): boolean {
  if (isBillingSettingsPath(pathname, search)) return true;
  if (pathname === "/dashboard/courses" || pathname === "/dashboard/courses/") {
    return false;
  }
  if (isPathOrPrefix(pathname, "/dashboard/courses")) return true;
  if (isPathOrPrefix(pathname, "/tutor-session")) return true;
  if (isPathOrPrefix(pathname, "/sessions")) return true;
  if (isPathOrPrefix(pathname, "/dashboard/review")) return true;
  if (isPathOrPrefix(pathname, "/notes/doc")) return true;
  if (isPathOrPrefix(pathname, "/notes/tutor")) return true;
  if (isPathOrPrefix(pathname, "/notes/material")) return true;
  if (/\/study(?:\/|$)/.test(pathname)) return true;
  if (/\/quiz(?:\/|$)/.test(pathname)) return true;
  if (/\/record(?:\/|$)/.test(pathname)) return true;
  if (/\/learn(?:\/|$)/.test(pathname)) return true;
  if (/\/live-notes(?:\/|$)/.test(pathname)) return true;
  return false;
}

/** Mutations unpaid users may still perform (checkout, tour, setup). */
export function isUnpaidMutationAllowedApi(pathname: string): boolean {
  if (pathname.startsWith("/api/billing")) return true;
  if (pathname.startsWith("/api/product-tour")) return true;
  if (pathname.startsWith("/api/onboarding")) return true;
  if (pathname === "/api/ui-locale" || pathname.startsWith("/api/ui-locale/")) {
    return true;
  }
  if (pathname === "/api/checkin" || pathname.startsWith("/api/checkin/")) {
    return true;
  }
  if (
    pathname === "/api/admin/impersonate" ||
    pathname.startsWith("/api/admin/impersonate/")
  ) {
    return true;
  }
  return false;
}

export function unpaidUserHasTourAccess(cookieValue: string | null | undefined): boolean {
  return parseTourDemoCookie(cookieValue) != null;
}

/** @deprecated Unpaid users can browse; kept for older tests. */
export function isUnpaidProductAllowedPath(
  pathname: string,
  search = ""
): boolean {
  if (pathname === "/onboarding" || pathname.startsWith("/onboarding/")) {
    return true;
  }
  if (pathname === "/help" || pathname.startsWith("/help/")) return true;
  if (pathname.startsWith("/legal")) return true;
  if (pathname.startsWith("/api/")) return true;
  const raw = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(raw);
  if (
    params.get("tour") === "1" ||
    params.get("setupUpgrade") === "1" ||
    params.get("upgrade") === "1"
  ) {
    return true;
  }
  if (isBillingSettingsPath(pathname, search)) return false;
  return true;
}

export const PAID_ACCESS_REDIRECT = UPGRADE_POPUP_PATH;
