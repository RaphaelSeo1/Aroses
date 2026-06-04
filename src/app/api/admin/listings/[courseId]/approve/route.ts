import { NextResponse } from "next/server";
import { marketplaceApiUnavailable } from "@/lib/marketplace/api-guard";
import { isAppAdminEnvUser } from "@/lib/app-admin-env";
import { logActivity } from "@/lib/activity-log";
import {
  fetchSellerPayoutAccount,
  sellerCanReceivePayments,
} from "@/lib/marketplace/connect";
import { isMarketplacePaymentsEnabled } from "@/lib/marketplace/platform-fee";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ courseId: string }> };

export async function POST(_req: Request, ctx: Params) {
  const blocked = marketplaceApiUnavailable();
  if (blocked) return blocked;

  const { courseId } = await ctx.params;
  if (!UUID_RE.test(courseId)) {
    return NextResponse.json({ error: "Invalid course id." }, { status: 400 });
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

  const now = new Date().toISOString();
  const { data: updated, error } = await admin
    .from("course_listings")
    .update({
      status: "approved",
      reviewed_by: user.id,
      reviewed_at: now,
      approved_at: now,
      rejection_reason: null,
      updated_at: now,
    })
    .eq("course_id", courseId)
    .eq("status", "pending_review")
    .select("course_id, seller_user_id")
    .maybeSingle();

  if (error) {
    console.error("[admin listing approve]", error);
    return NextResponse.json({ error: "Could not approve." }, { status: 500 });
  }
  if (!updated) {
    return NextResponse.json({ error: "Listing not pending review." }, { status: 404 });
  }

  if (isMarketplacePaymentsEnabled()) {
    const payout = await fetchSellerPayoutAccount(admin, updated.seller_user_id);
    if (!sellerCanReceivePayments(payout)) {
      return NextResponse.json(
        {
          error:
            "Seller has not finished Stripe payout setup. Ask them to connect payouts before approving.",
        },
        { status: 400 }
      );
    }
  }

  await admin
    .from("courses")
    .update({ is_public: false })
    .eq("id", courseId);

  await logActivity({
    userId: user.id,
    type: "listing_approved",
    summary: `Approved marketplace listing`,
    metadata: { courseId },
  });

  return NextResponse.json({ ok: true });
}
