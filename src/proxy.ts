import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { parseSafeInternalNext } from "@/lib/internal-next-path";
import { isAppAdminEnvUser } from "@/lib/app-admin-env";
import {
  getImpersonationSecret,
  IMPERSONATION_COOKIE,
  clearImpersonationCookieOptions,
  verifyImpersonationCookie,
} from "@/lib/impersonation/cookie";
import { resolveProxyViewer } from "@/lib/impersonation/guard";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  emailMatchesAllowedDomains,
  isAuthEmailDomainAllowlistEnforced,
  parseAllowedAuthEmailDomains,
} from "@/lib/school-email-policy";
import { getProfileOnboardingState } from "@/lib/onboarding-gate";
import {
  AUTH_SUPABASE_TIMEOUT_MS,
  createBoundedSupabaseFetchWithRetry,
} from "@/lib/supabase/bounded-fetch";
import {
  isMissingAuthSessionError,
  isPublicUnauthenticatedPath,
  isSupabaseTransportError,
  isSupabaseTransportFailure,
  nextPathForUnauthenticated,
  unauthenticatedHomePath,
  unauthenticatedProductEntryPath,
} from "@/lib/auth/public-routes";
import {
  hasPaidProductAccess,
  snapshotFromSubscriptionRow,
  isUnpaidMutationAllowedApi,
  PAID_PLAN_REQUIRED_CODE,
  UPGRADE_POPUP_PATH,
  unpaidUserHasTourAccess,
  unpaidUserShouldBlockFeaturePath,
} from "@/lib/billing/paid-access";
import { isBillingUiEnabled } from "@/lib/billing/feature-flag";
import { TOUR_DEMO_COOKIE } from "@/lib/product-tour/tour-demo-cookie";
import {
  isSitePauseExemptPath,
  isSitePaused,
  sitePauseAllowsUser,
} from "@/lib/site-pause";

function pauseDenial(
  request: NextRequest,
  baseResponse: NextResponse
): NextResponse {
  const pathname = request.nextUrl.pathname;
  if (pathname.startsWith("/api/")) {
    const response = NextResponse.json(
      { error: "Aroses is paused." },
      {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      }
    );
    baseResponse.cookies.getAll().forEach((cookie) => {
      response.cookies.set(cookie.name, cookie.value);
    });
    return response;
  }
  const url = request.nextUrl.clone();
  url.pathname = "/paused";
  url.search = "";
  const redirectResponse = NextResponse.redirect(url);
  baseResponse.cookies.getAll().forEach((cookie) => {
    redirectResponse.cookies.set(cookie.name, cookie.value);
  });
  return redirectResponse;
}

function unavailableResponse(baseResponse: NextResponse): NextResponse {
  const response = NextResponse.json(
    { error: "Authentication service temporarily unavailable." },
    {
      status: 503,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": "5",
      },
    }
  );
  baseResponse.cookies.getAll().forEach((cookie) => {
    response.cookies.set(cookie.name, cookie.value);
  });
  return response;
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  const mutatingApi =
    pathname.startsWith("/api/") &&
    request.method !== "GET" &&
    request.method !== "HEAD" &&
    request.method !== "OPTIONS";

  // API GET/HEAD (and allowed unpaid mutations like checkout) skip the
  // global user gate; mutating product APIs still need a paid check below.
  // While the site is paused this skip would let signed-out clients keep
  // calling product APIs, so the pause check below has to see the user.
  if (
    !isSitePaused() &&
    pathname.startsWith("/api/") &&
    !isAuthEmailDomainAllowlistEnforced() &&
    (!mutatingApi || isUnpaidMutationAllowedApi(pathname))
  ) {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        fetch: createBoundedSupabaseFetchWithRetry(
          AUTH_SUPABASE_TIMEOUT_MS,
          1
        ),
      },
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  let user;
  try {
    const result = await supabase.auth.getUser();
    if (result.error && !isMissingAuthSessionError(result.error)) {
      if (isSupabaseTransportError(result.error)) {
        console.error(
          "[proxy] Supabase auth slow — passing through:",
          result.error.message
        );
        if (
          isSitePaused() &&
          !isSitePauseExemptPath(pathname)
        ) {
          return pauseDenial(request, supabaseResponse);
        }
        return supabaseResponse;
      }
      console.error("[proxy] Supabase auth unavailable:", result.error.message);
      return unavailableResponse(supabaseResponse);
    }
    user = result.data.user;
    if (
      isSitePaused() &&
      !isSitePauseExemptPath(pathname) &&
      !sitePauseAllowsUser(user)
    ) {
      return pauseDenial(request, supabaseResponse);
    }
  } catch (error) {
    if (isSupabaseTransportFailure(error)) {
      console.error("[proxy] Supabase auth slow — passing through:", error);
      if (isSitePaused() && !isSitePauseExemptPath(pathname)) {
        return pauseDenial(request, supabaseResponse);
      }
      return supabaseResponse;
    }
    console.error("[proxy] Supabase auth request failed:", error);
    return unavailableResponse(supabaseResponse);
  }

  function pathAllowedDuringOnboarding(p: string) {
    return (
      p === "/onboarding" ||
      p.startsWith("/onboarding/") ||
      p.startsWith("/api/") ||
      p.startsWith("/legal/") ||
      p === "/help"
    );
  }

  const impersonation = user
    ? await verifyImpersonationCookie(
        request.cookies.get(IMPERSONATION_COOKIE)?.value,
        getImpersonationSecret()
      )
    : null;
  const viewer = user
    ? resolveProxyViewer({ realUser: user, impersonation })
    : null;

  let onboardingState: "complete" | "required" | "unavailable" = "complete";
  try {
    if (user?.id && viewer) {
      if (viewer.isImpersonating) {
        const admin = createAdminClient();
        if (admin) {
          onboardingState = await getProfileOnboardingState(
            admin,
            viewer.viewerId
          );
          if (onboardingState === "unavailable") {
            onboardingState = "complete";
          }
        }
      } else {
        onboardingState = await getProfileOnboardingState(supabase, user.id);
      }
    }
  } catch (error) {
    if (viewer?.isImpersonating) {
      console.error("[proxy] impersonation profile lookup failed:", error);
      onboardingState = "complete";
    } else if (isSupabaseTransportFailure(error)) {
      console.error(
        "[proxy] Supabase profile slow — skipping onboarding gate:",
        error
      );
      onboardingState = "complete";
    } else {
      console.error("[proxy] Supabase profile request failed:", error);
      return unavailableResponse(supabaseResponse);
    }
  }
  if (onboardingState === "unavailable") {
    console.error(
      "[proxy] onboarding profile unavailable — skipping gate this request"
    );
    onboardingState = "complete";
  }
  const needsOnboarding = onboardingState === "required";

  if (user && needsOnboarding && !pathAllowedDuringOnboarding(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/onboarding";
    url.search = "";
    const redirectResponse = NextResponse.redirect(url);
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      redirectResponse.cookies.set(cookie.name, cookie.value);
    });
    return redirectResponse;
  }
  const fullPath = `${pathname}${request.nextUrl.search}`;

  if (!user && !pathname.startsWith("/api/")) {
    if (!isPublicUnauthenticatedPath(pathname)) {
      const url = request.nextUrl.clone();
      if (pathname === "/" || pathname === "") {
        url.pathname = unauthenticatedHomePath();
        url.search = "";
      } else {
        url.pathname = unauthenticatedProductEntryPath();
        url.search = "";
        url.searchParams.set(
          "next",
          nextPathForUnauthenticated(pathname, fullPath)
        );
      }
      return NextResponse.redirect(url);
    }
  }

  const allowedDomains = isAuthEmailDomainAllowlistEnforced()
    ? parseAllowedAuthEmailDomains()
    : [];
  const authPublicRoutes =
    pathname.startsWith("/login") || pathname.startsWith("/signup");

  if (
    user &&
    allowedDomains.length > 0 &&
    !emailMatchesAllowedDomains(user.email, allowedDomains) &&
    !authPublicRoutes
  ) {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        console.error("[proxy] Supabase sign-out unavailable:", error.message);
        return unavailableResponse(supabaseResponse);
      }
    } catch (error) {
      console.error("[proxy] Supabase sign-out request failed:", error);
      return unavailableResponse(supabaseResponse);
    }
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    loginUrl.searchParams.set("auth_error", "school_email");
    const redirectResponse = NextResponse.redirect(loginUrl);
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      redirectResponse.cookies.set(cookie.name, cookie.value);
    });
    redirectResponse.cookies.set(
      IMPERSONATION_COOKIE,
      "",
      clearImpersonationCookieOptions(process.env.NODE_ENV === "production")
    );
    return redirectResponse;
  }

  if (user && pathname.startsWith("/dashboard/admin")) {
    if (!isAppAdminEnvUser(user) || viewer?.isImpersonating) {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  const paywallUser = viewer
    ? { id: viewer.viewerId, email: viewer.viewerEmail }
    : user
      ? { id: user.id, email: user.email }
      : null;

  if (
    user &&
    paywallUser &&
    !needsOnboarding &&
    isBillingUiEnabled() &&
    !isAppAdminEnvUser(paywallUser)
  ) {
    let paid = false;
    const billingClient =
      viewer?.isImpersonating ? createAdminClient() ?? supabase : supabase;
    try {
      const full = await billingClient
        .from("user_subscriptions")
        .select(
          "tier, status, admin_granted, grant_source, current_period_end"
        )
        .eq("user_id", paywallUser.id)
        .maybeSingle();
      if (full.error && /grant_source|schema cache/i.test(full.error.message ?? "")) {
        const mid = await billingClient
          .from("user_subscriptions")
          .select("tier, status, admin_granted")
          .eq("user_id", paywallUser.id)
          .maybeSingle();
        if (mid.error && /admin_granted|schema cache/i.test(mid.error.message ?? "")) {
          const legacy = await billingClient
            .from("user_subscriptions")
            .select("tier, status")
            .eq("user_id", paywallUser.id)
            .maybeSingle();
          paid = hasPaidProductAccess(legacy.data);
        } else if (!mid.error) {
          paid = hasPaidProductAccess(snapshotFromSubscriptionRow(mid.data));
        }
      } else if (!full.error) {
        paid = hasPaidProductAccess(snapshotFromSubscriptionRow(full.data));
      }
    } catch (error) {
      if (viewer?.isImpersonating) {
        console.error("[proxy] impersonation subscription lookup failed:", error);
      } else if (isSupabaseTransportFailure(error)) {
        console.error(
          "[proxy] subscription lookup slow — skipping paywall gate:",
          error
        );
      } else {
        console.error("[proxy] subscription lookup failed:", error);
        return unavailableResponse(supabaseResponse);
      }
    }

    const tourCookie = request.cookies.get(TOUR_DEMO_COOKIE)?.value ?? null;
    const search = request.nextUrl.search.replace(/^\?/, "");
    const tourOk = unpaidUserHasTourAccess(tourCookie);

    if (
      mutatingApi &&
      !paid &&
      !tourOk &&
      !isUnpaidMutationAllowedApi(pathname)
    ) {
      const response = NextResponse.json(
        {
          error: "Choose a plan to use Aroses.",
          code: PAID_PLAN_REQUIRED_CODE,
        },
        { status: 402 }
      );
      supabaseResponse.cookies.getAll().forEach((cookie) => {
        response.cookies.set(cookie.name, cookie.value);
      });
      return response;
    }

    if (
      !paid &&
      !tourOk &&
      !pathname.startsWith("/api/") &&
      unpaidUserShouldBlockFeaturePath(pathname, search)
    ) {
      const dest = new URL(UPGRADE_POPUP_PATH, request.nextUrl.origin);
      const redirectResponse = NextResponse.redirect(dest);
      supabaseResponse.cookies.getAll().forEach((cookie) => {
        redirectResponse.cookies.set(cookie.name, cookie.value);
      });
      return redirectResponse;
    }
  }

  if (
    user &&
    !needsOnboarding &&
    (pathname === "/login" || pathname === "/signup")
  ) {
    const next = parseSafeInternalNext(
      request.nextUrl.searchParams.get("next")
    );
    const url = request.nextUrl.clone();
    if (next) {
      const resolved = new URL(next, request.nextUrl.origin);
      url.pathname = resolved.pathname;
      url.search = resolved.search;
    } else {
      url.pathname = "/";
      url.search = "";
    }
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!auth(?:/|$)|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
