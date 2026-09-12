import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { isAppAdminEnvUser } from "@/lib/app-admin-env";
import {
  hasPaidProductAccess,
  type PaidGateAccess,
} from "@/lib/billing/paid-access";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSessionClient } from "@/lib/supabase/session-client";
import {
  getImpersonationSecret,
  IMPERSONATION_COOKIE,
  verifyImpersonationCookie,
} from "./cookie.ts";
import { isValidImpersonator } from "./guard.ts";

export type ImpersonationViewState = {
  targetId: string;
  targetEmail: string;
  paidAccess: PaidGateAccess;
};

async function loadTargetPaidAccess(
  targetId: string,
  targetEmail: string
): Promise<PaidGateAccess> {
  if (isAppAdminEnvUser({ id: targetId, email: targetEmail })) {
    return "paid";
  }
  const admin = createAdminClient();
  if (!admin) return "unknown";
  try {
    const { data, error } = await admin
      .from("user_subscriptions")
      .select("tier, status, admin_granted")
      .eq("user_id", targetId)
      .maybeSingle();
    if (error && /admin_granted|schema cache/i.test(error.message ?? "")) {
      const legacy = await admin
        .from("user_subscriptions")
        .select("tier, status")
        .eq("user_id", targetId)
        .maybeSingle();
      return hasPaidProductAccess(legacy.data) ? "paid" : "unpaid";
    }
    if (error) return "unknown";
    return hasPaidProductAccess({
      tier: data?.tier,
      status: data?.status,
      adminGranted: Boolean(
        (data as { admin_granted?: boolean } | null)?.admin_granted
      ),
    })
      ? "paid"
      : "unpaid";
  } catch {
    return "unknown";
  }
}

/**
 * Active view-as session for the current request, or null. Uses the real
 * admin session (not the acting user) so the banner cannot be spoofed.
 */
export const getImpersonationViewState: () => Promise<ImpersonationViewState | null> =
  cache(async () => {
    const store = await cookies();
    const payload = await verifyImpersonationCookie(
      store.get(IMPERSONATION_COOKIE)?.value,
      getImpersonationSecret()
    );
    if (!payload) return null;

    const supabase = await createSessionClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!isValidImpersonator(user, payload)) return null;

    return {
      targetId: payload.targetId,
      targetEmail: payload.targetEmail,
      paidAccess: await loadTargetPaidAccess(
        payload.targetId,
        payload.targetEmail
      ),
    };
  });
