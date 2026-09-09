import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { parseSafeInternalNext } from "@/lib/internal-next-path";
import { isAppAdminEnvUser } from "@/lib/app-admin-env";
import {
  emailMatchesAllowedDomains,
  isAuthEmailDomainAllowlistEnforced,
  parseAllowedAuthEmailDomains,
} from "@/lib/school-email-policy";
import { getProfileOnboardingState } from "@/lib/onboarding-gate";
import { createBoundedSupabaseFetch } from "@/lib/supabase/bounded-fetch";
import {
  isMissingAuthSessionError,
  isPublicUnauthenticatedPath,
  nextPathForUnauthenticated,
  unauthenticatedHomePath,
  unauthenticatedProductEntryPath,
} from "@/lib/auth/public-routes";
import {
  hasPaidProductAccess,
  isUnpaidProductAllowedPath,
  PAID_ACCESS_REDIRECT,
  unpaidUserHasTourAccess,
} from "@/lib/billing/paid-access";
import { isBillingUiEnabled } from "@/lib/billing/feature-flag";
import { TOUR_DEMO_COOKIE } from "@/lib/product-tour/tour-demo-cookie";

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

  // API handlers perform their own user/authorization checks. The optional
  // email-domain gate is the only cross-cutting API policy retained here.
  if (
    pathname.startsWith("/api/") &&
    !isAuthEmailDomainAllowlistEnforced()
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
        fetch: createBoundedSupabaseFetch(),
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
      console.error("[proxy] Supabase auth unavailable:", result.error.message);
      return unavailableResponse(supabaseResponse);
    }
    user = result.data.user;
  } catch (error) {
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

  let onboardingState: "complete" | "required" | "unavailable" = "complete";
  try {
    if (user?.id) {
      onboardingState = await getProfileOnboardingState(supabase, user.id);
    }
  } catch (error) {
    console.error("[proxy] Supabase profile request failed:", error);
    return unavailableResponse(supabaseResponse);
  }
  if (onboardingState === "unavailable") {
    return unavailableResponse(supabaseResponse);
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
    return redirectResponse;
  }

  if (user && pathname.startsWith("/dashboard/admin")) {
    if (!isAppAdminEnvUser(user)) {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  if (
    user &&
    !needsOnboarding &&
    isBillingUiEnabled() &&
    !isAppAdminEnvUser(user) &&
    !pathname.startsWith("/api/")
  ) {
    let paid = false;
    try {
      const { data, error } = await supabase
        .from("user_subscriptions")
        .select("tier, status, admin_granted")
        .eq("user_id", user.id)
        .maybeSingle();
      if (error && /admin_granted|schema cache/i.test(error.message ?? "")) {
        const legacy = await supabase
          .from("user_subscriptions")
          .select("tier, status")
          .eq("user_id", user.id)
          .maybeSingle();
        paid = hasPaidProductAccess(legacy.data);
      } else if (!error) {
        paid = hasPaidProductAccess({
          tier: data?.tier,
          status: data?.status,
          adminGranted: Boolean(
            (data as { admin_granted?: boolean } | null)?.admin_granted
          ),
        });
      }
    } catch (error) {
      console.error("[proxy] subscription lookup failed:", error);
      return unavailableResponse(supabaseResponse);
    }

    const tourCookie = request.cookies.get(TOUR_DEMO_COOKIE)?.value ?? null;
    const search = request.nextUrl.search.replace(/^\?/, "");
    if (
      !paid &&
      !unpaidUserHasTourAccess(tourCookie) &&
      !isUnpaidProductAllowedPath(pathname, search)
    ) {
      const dest = new URL(PAID_ACCESS_REDIRECT, request.nextUrl.origin);
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
    "/((?!intro(?:/|$)|help(?:/|$)|legal(?:/|$)|auth(?:/|$)|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
