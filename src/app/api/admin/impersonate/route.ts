import { NextResponse, type NextRequest } from "next/server";
import { requireAppAdminUser } from "@/lib/app-admin-env";
import { logImpersonationAudit } from "@/lib/impersonation/audit";
import {
  getImpersonationSecret,
  impersonationCookieOptions,
  IMPERSONATION_COOKIE,
  buildImpersonationPayload,
  signImpersonationCookie,
  verifyImpersonationCookie,
} from "@/lib/impersonation/cookie";
import {
  canStartImpersonationSession,
  parseImpersonateTarget,
} from "@/lib/impersonation/guard";
import { findAuthUserByEmailOrId } from "@/lib/impersonation/lookup";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSessionClient } from "@/lib/supabase/session-client";

export async function POST(request: NextRequest) {
  const supabase = await createSessionClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const gate = requireAppAdminUser(user);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const secret = getImpersonationSecret();
  if (!secret) {
    return NextResponse.json(
      { error: "Impersonation is not configured." },
      { status: 503 }
    );
  }

  const existing = await verifyImpersonationCookie(
    request.cookies.get(IMPERSONATION_COOKIE)?.value,
    secret
  );
  const startGate = canStartImpersonationSession({
    realUser: gate.user,
    existingPayload: existing,
  });
  if (!startGate.ok) {
    return NextResponse.json(
      { error: startGate.error },
      { status: startGate.status }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const parsed = parseImpersonateTarget(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json(
      { error: "Service role key is not configured." },
      { status: 503 }
    );
  }

  const lookup = await findAuthUserByEmailOrId(admin, parsed.query);
  if (!lookup.ok) {
    return NextResponse.json({ error: lookup.error }, { status: lookup.status });
  }

  const targetEmail = (lookup.user.email ?? "").trim().toLowerCase();
  if (!targetEmail) {
    return NextResponse.json(
      { error: "That account has no email to display." },
      { status: 400 }
    );
  }

  const payload = buildImpersonationPayload({
    adminId: gate.user.id,
    targetId: lookup.user.id,
    targetEmail,
  });
  const token = await signImpersonationCookie(payload, secret);

  await logImpersonationAudit({
    action: "start",
    adminUserId: gate.user.id,
    adminEmail: gate.user.email ?? null,
    targetUserId: lookup.user.id,
    targetEmail,
  });

  const res = NextResponse.json({
    ok: true,
    email: targetEmail,
    userId: lookup.user.id,
    redirectTo: "/",
  });
  res.cookies.set(
    IMPERSONATION_COOKIE,
    token,
    impersonationCookieOptions(process.env.NODE_ENV === "production")
  );
  return res;
}
