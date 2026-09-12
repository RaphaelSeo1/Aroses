import { NextResponse, type NextRequest } from "next/server";
import { requireAppAdminUser } from "@/lib/app-admin-env";
import { logImpersonationAudit } from "@/lib/impersonation/audit";
import {
  clearImpersonationCookieOptions,
  getImpersonationSecret,
  IMPERSONATION_COOKIE,
  verifyImpersonationCookie,
} from "@/lib/impersonation/cookie";
import { createSessionClient } from "@/lib/supabase/session-client";

function exitRedirect(request: NextRequest): URL {
  return new URL("/dashboard/admin", request.nextUrl.origin);
}

function withClearedCookie(response: NextResponse): NextResponse {
  response.cookies.set(
    IMPERSONATION_COOKIE,
    "",
    clearImpersonationCookieOptions(process.env.NODE_ENV === "production")
  );
  return response;
}

/**
 * Restore the real admin session. Uses the unwrapped session so Exit works
 * while `getUser()` is returning the impersonated user elsewhere.
 */
export async function POST(request: NextRequest) {
  const supabase = await createSessionClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const gate = requireAppAdminUser(user);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const payload = await verifyImpersonationCookie(
    request.cookies.get(IMPERSONATION_COOKIE)?.value,
    getImpersonationSecret()
  );
  if (payload && payload.adminId === gate.user.id) {
    await logImpersonationAudit({
      action: "stop",
      adminUserId: gate.user.id,
      adminEmail: gate.user.email ?? null,
      targetUserId: payload.targetId,
      targetEmail: payload.targetEmail,
    });
  }

  const accept = request.headers.get("accept") ?? "";
  if (accept.includes("text/html")) {
    return withClearedCookie(NextResponse.redirect(exitRedirect(request)));
  }

  const res = NextResponse.json({
    ok: true,
    redirectTo: "/dashboard/admin",
  });
  return withClearedCookie(res);
}
