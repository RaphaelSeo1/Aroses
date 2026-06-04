import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logActivity } from "@/lib/activity-log";
import { createAdminClient } from "@/lib/supabase/admin";
import { computePlatformFeeCents } from "@/lib/marketplace/platform-fee";

export type PurchaseStatus = "pending" | "completed" | "refunded";

export async function hasPurchasedCourse(
  supabase: SupabaseClient,
  userId: string,
  courseId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("course_purchases")
    .select("id")
    .eq("buyer_user_id", userId)
    .eq("course_id", courseId)
    .eq("status", "completed")
    .maybeSingle();
  return Boolean(data);
}

export async function completeCoursePurchaseFromCheckout(
  session: Stripe.Checkout.Session
): Promise<void> {
  if (session.mode !== "payment") return;
  if (session.metadata?.purchase_type !== "course") return;
  if (session.payment_status !== "paid") return;

  const courseId = session.metadata.course_id;
  const buyerUserId = session.metadata.buyer_user_id;
  const sellerUserId = session.metadata.seller_user_id;
  const priceCentsRaw = session.metadata.price_cents;

  if (
    !courseId ||
    !buyerUserId ||
    !sellerUserId ||
    !session.id ||
    !priceCentsRaw
  ) {
    console.error("[marketplace] checkout missing metadata", session.id);
    return;
  }

  const priceCents = Number.parseInt(priceCentsRaw, 10);
  if (!Number.isFinite(priceCents)) return;

  const admin = createAdminClient();
  if (!admin) {
    throw new Error("Admin client not configured");
  }

  const platformFeeCents = computePlatformFeeCents(priceCents);
  const now = new Date().toISOString();
  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id ?? null;

  const { error } = await admin.from("course_purchases").upsert(
    {
      buyer_user_id: buyerUserId,
      course_id: courseId,
      seller_user_id: sellerUserId,
      price_cents: priceCents,
      currency: (session.currency ?? "usd").toLowerCase(),
      platform_fee_cents: platformFeeCents,
      stripe_checkout_session_id: session.id,
      stripe_payment_intent_id: paymentIntentId,
      status: "completed",
      purchased_at: now,
      updated_at: now,
    },
    { onConflict: "stripe_checkout_session_id" }
  );

  if (error) {
    console.error("[marketplace] record purchase failed", error);
    throw error;
  }

  await logActivity({
    userId: buyerUserId,
    type: "course_purchased",
    summary: `Purchased course ${courseId}`,
    metadata: { courseId, sellerUserId, priceCents },
  });
}
