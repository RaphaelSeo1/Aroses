import { NextResponse } from "next/server";
import { isAppAdminEnvUser } from "@/lib/app-admin-env";
import { logActivity } from "@/lib/activity-log";
import {
  ADMIN_SUBSCRIPTION_STATUSES,
  adminSetUserSubscription,
  type AdminSubscriptionStatus,
} from "@/lib/billing/subscription";
import type { PlanTier } from "@/lib/billing/plans";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const TIERS = new Set<PlanTier>(["free", "student", "premium"]);
const STATUSES = new Set<string>(ADMIN_SUBSCRIPTION_STATUSES);

type Params = { params: Promise<{ userId: string }> };

export async function POST(req: Request, ctx: Params) {
  const { userId } = await ctx.params;
  if (!UUID_RE.test(userId)) {
    return NextResponse.json({ error: "Invalid user id." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isAppAdminEnvUser(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server misconfigured." }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const tierRaw =
    typeof body === "object" && body && "tier" in body
      ? String((body as { tier: unknown }).tier).trim().toLowerCase()
      : "";
  const statusRaw =
    typeof body === "object" && body && "status" in body
      ? String((body as { status: unknown }).status).trim().toLowerCase()
      : "";

  if (!TIERS.has(tierRaw as PlanTier)) {
    return NextResponse.json(
      { error: "tier must be free, student, or premium." },
      { status: 400 }
    );
  }
  if (!STATUSES.has(statusRaw)) {
    return NextResponse.json(
      {
        error: `status must be one of: ${ADMIN_SUBSCRIPTION_STATUSES.join(", ")}.`,
      },
      { status: 400 }
    );
  }

  const tier = tierRaw as PlanTier;
  const status = statusRaw as AdminSubscriptionStatus;

  // Paid + inactive is confusing — coerce to active unless explicitly canceled.
  const normalizedStatus: AdminSubscriptionStatus =
    tier !== "free" && status === "inactive" ? "active" : status;

  try {
    const subscription = await adminSetUserSubscription({
      userId,
      tier,
      status: normalizedStatus,
    });

    await logActivity({
      userId: user.id,
      type: "subscription_admin_updated",
      summary: `Set ${userId.slice(0, 8)}… to ${tier}/${normalizedStatus}`,
      metadata: {
        targetUserId: userId,
        tier,
        status: normalizedStatus,
        adminGranted: subscription.adminGranted,
      },
    });

    return NextResponse.json({ ok: true, subscription });
  } catch (err) {
    console.error("[admin subscription]", err);
    const message =
      err instanceof Error && err.message.trim()
        ? err.message.trim()
        : "Could not update subscription.";
    if (/admin_granted/i.test(message)) {
      return NextResponse.json(
        {
          error:
            "Database is missing admin_granted. Run migration 099 (or 100) in Supabase, then retry.",
        },
        { status: 500 }
      );
    }
    if (/user_subscriptions_tier_check|tier_check/i.test(message)) {
      return NextResponse.json(
        {
          error:
            "Database tier check is out of date (rejects student/premium). Run migration 100_fix_subscription_tier_check.sql in the Supabase SQL editor, then retry.",
        },
        { status: 500 }
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
