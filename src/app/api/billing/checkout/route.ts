import { NextResponse } from "next/server";
import { isBillingUiEnabled } from "@/lib/billing/feature-flag";
import { PLANS, type PlanTier } from "@/lib/billing/plans";
import { getOrCreateStripeCustomer } from "@/lib/billing/subscription";
import { getStripe, isStripeConfigured, originFromRequest } from "@/lib/stripe/client";
import { createRouteHandlerSupabase } from "@/lib/supabase/route-handler-client";

export const runtime = "nodejs";

/** Start a Stripe-hosted Checkout Session for an upgrade. Card data never touches us. */
export async function POST(request: Request) {
  if (!isBillingUiEnabled()) {
    return NextResponse.json({ error: "Billing is not available yet." }, { status: 404 });
  }

  if (!isStripeConfigured()) {
    return NextResponse.json(
      { error: "Billing isn't configured yet." },
      { status: 503 }
    );
  }

  const supabase = await createRouteHandlerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to upgrade." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const tier = (body as { tier?: unknown }).tier as PlanTier;
  if (tier !== "student" && tier !== "premium") {
    return NextResponse.json({ error: "Choose a paid plan." }, { status: 400 });
  }

  const priceId = PLANS[tier].stripePriceId;
  if (!priceId) {
    return NextResponse.json(
      { error: `The ${PLANS[tier].name} plan isn't configured yet.` },
      { status: 500 }
    );
  }

  try {
    const customerId = await getOrCreateStripeCustomer({
      userId: user.id,
      email: user.email ?? null,
    });
    const origin = originFromRequest(request);
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/dashboard/billing?status=success`,
      cancel_url: `${origin}/dashboard/billing?status=cancel`,
      allow_promotion_codes: true,
      client_reference_id: user.id,
      // Stamp the user id everywhere the webhook might read it.
      metadata: { user_id: user.id },
      subscription_data: { metadata: { user_id: user.id } },
    });

    if (!session.url) {
      throw new Error("Stripe did not return a checkout URL.");
    }
    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("[billing] checkout failed", err);
    return NextResponse.json(
      { error: "Could not start checkout. Try again." },
      { status: 500 }
    );
  }
}
