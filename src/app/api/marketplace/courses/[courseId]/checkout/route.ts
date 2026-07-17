import { NextResponse } from "next/server";
import { marketplaceApiUnavailable } from "@/lib/marketplace/api-guard";
import {
  fetchSellerPayoutAccount,
  refreshConnectAccountFromStripe,
  sellerCanReceivePayments,
} from "@/lib/marketplace/connect";
import {
  computePlatformFeeCents,
  isMarketplacePaymentsEnabled,
} from "@/lib/marketplace/platform-fee";
import { hasPurchasedCourse } from "@/lib/marketplace/purchases";
import { formatPrice } from "@/lib/marketplace/listing-access";
import { getStripe, isStripeConfigured, originFromRequest } from "@/lib/stripe/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ courseId: string }> };

/** Stripe Checkout for a one-time course purchase (Connect destination charge). */
export async function POST(request: Request, ctx: Params) {
  const blocked = marketplaceApiUnavailable();
  if (blocked) return blocked;

  const { courseId } = await ctx.params;
  if (!UUID_RE.test(courseId)) {
    return NextResponse.json({ error: "Invalid course id." }, { status: 400 });
  }

  if (!isMarketplacePaymentsEnabled() || !isStripeConfigured()) {
    return NextResponse.json(
      { error: "Marketplace payments are not configured yet." },
      { status: 503 }
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to purchase." }, { status: 401 });
  }

  const { data: course } = await supabase
    .from("courses")
    .select("id, title, description, user_id, is_self_study")
    .eq("id", courseId)
    .maybeSingle();

  if (!course || course.is_self_study) {
    return NextResponse.json({ error: "Course not found." }, { status: 404 });
  }
  if (course.user_id === user.id) {
    return NextResponse.json(
      { error: "You already own this course." },
      { status: 400 }
    );
  }

  const { data: listing } = await supabase
    .from("course_listings")
    .select("status, price_cents, currency, seller_user_id")
    .eq("course_id", courseId)
    .maybeSingle();

  if (!listing || listing.status !== "approved") {
    return NextResponse.json(
      { error: "This course is not available for purchase." },
      { status: 404 }
    );
  }

  if (await hasPurchasedCourse(supabase, user.id, courseId)) {
    return NextResponse.json(
      { error: "You already purchased this course." },
      { status: 409 }
    );
  }

  // Buyers cannot read another user's payout row under RLS — use service role.
  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json(
      { error: "Marketplace payments are not configured yet." },
      { status: 503 }
    );
  }

  let sellerAccount = await fetchSellerPayoutAccount(
    admin,
    listing.seller_user_id
  );
  if (
    sellerAccount?.stripeAccountId &&
    !sellerCanReceivePayments(sellerAccount)
  ) {
    const refreshed = await refreshConnectAccountFromStripe(
      sellerAccount.stripeAccountId
    );
    if (refreshed) sellerAccount = refreshed;
  }
  if (!sellerCanReceivePayments(sellerAccount)) {
    return NextResponse.json(
      { error: "This seller has not finished payout setup yet." },
      { status: 503 }
    );
  }

  const priceCents = listing.price_cents;
  const platformFeeCents = computePlatformFeeCents(priceCents);
  const origin = originFromRequest(request);

  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: listing.currency,
            unit_amount: priceCents,
            product_data: {
              name: course.title,
              description:
                course.description?.slice(0, 500) ||
                "Course on Aroses Explore",
            },
          },
          quantity: 1,
        },
      ],
      payment_intent_data: {
        application_fee_amount: platformFeeCents,
        transfer_data: {
          destination: sellerAccount!.stripeAccountId,
        },
        metadata: {
          purchase_type: "course",
          course_id: courseId,
          buyer_user_id: user.id,
          seller_user_id: listing.seller_user_id,
        },
      },
      success_url: `${origin}/explore/${courseId}?purchase=success`,
      cancel_url: `${origin}/explore/${courseId}?purchase=cancel`,
      client_reference_id: user.id,
      metadata: {
        purchase_type: "course",
        course_id: courseId,
        buyer_user_id: user.id,
        seller_user_id: listing.seller_user_id,
        price_cents: String(priceCents),
      },
    });

    if (!session.url) {
      throw new Error("Stripe did not return a checkout URL.");
    }

    return NextResponse.json({
      url: session.url,
      priceLabel: formatPrice(priceCents, listing.currency),
    });
  } catch (err) {
    console.error("[marketplace] checkout failed", err);
    return NextResponse.json(
      { error: "Could not start checkout. Try again." },
      { status: 500 }
    );
  }
}
