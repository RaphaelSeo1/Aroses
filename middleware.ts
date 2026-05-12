import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { parseSafeInternalNext } from "@/lib/internal-next-path";
import { isAppAdminEnvUser } from "@/lib/app-admin-env";
import {
  emailMatchesAllowedDomains,
  isAuthEmailDomainAllowlistEnforced,
  parseAllowedAuthEmailDomains,
} from "@/lib/school-email-policy";
import { profileNeedsOnboarding } from "@/lib/onboarding-gate";

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  function pathAllowedDuringOnboarding(p: string) {
    return (
      p === "/onboarding" ||
      p.startsWith("/onboarding/") ||
      p.startsWith("/auth/") ||
      p.startsWith("/api/") ||
      p.startsWith("/legal/")
    );
  }

  const needsOnboarding = user?.id
    ? await profileNeedsOnboarding(supabase, user.id)
    : false;

  if (user && needsOnboarding && !pathAllowedDuringOnboarding(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/onboarding";
    url.search = "";
    const redirectResponse = NextResponse.redirect(url);
    supabaseResponse.cookies.getAll().forEach((c) => {
      redirectResponse.cookies.set(c.name, c.value);
    });
    return redirectResponse;
  }
  const fullPath = `${pathname}${request.nextUrl.search}`;

  const allowedDomains = isAuthEmailDomainAllowlistEnforced()
    ? parseAllowedAuthEmailDomains()
    : [];
  const authPublicRoutes =
    pathname.startsWith("/login") ||
    pathname.startsWith("/signup") ||
    pathname.startsWith("/auth/");

  if (
    user &&
    allowedDomains.length > 0 &&
    !emailMatchesAllowedDomains(user.email, allowedDomains) &&
    !authPublicRoutes
  ) {
    await supabase.auth.signOut();
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    loginUrl.searchParams.set("auth_error", "school_email");
    const redirectResponse = NextResponse.redirect(loginUrl);
    supabaseResponse.cookies.getAll().forEach((c) => {
      redirectResponse.cookies.set(c.name, c.value);
    });
    return redirectResponse;
  }

  if (!user && pathname.startsWith("/dashboard")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    const nextPath =
      pathname === "/dashboard" || pathname === "/dashboard/"
        ? "/"
        : fullPath;
    url.searchParams.set("next", nextPath);
    return NextResponse.redirect(url);
  }

  if (user && pathname.startsWith("/dashboard/admin")) {
    if (!isAppAdminEnvUser(user)) {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  if (!user && pathname.startsWith("/explore")) {
    const url = request.nextUrl.clone();
    url.pathname = "/signup";
    url.searchParams.set("next", fullPath);
    return NextResponse.redirect(url);
  }

  if (user && !needsOnboarding && (pathname === "/login" || pathname === "/signup")) {
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
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
