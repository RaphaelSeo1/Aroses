import { NextResponse } from "next/server";
import { planCheckoutSessionParams } from "@/lib/billing/checkout-session";
import { isBillingUiEnabled } from "@/lib/billing/feature-flag";
import { PLANS } from "@/lib/billing/plans";
import {
  assertCheckoutTier,
  checkoutPriceEnvName,
  checkoutStripePriceId,
} from "@/lib/billing/sale";
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

  const tier = assertCheckoutTier((body as { tier?: unknown }).tier);
  if (!tier) {
    return NextResponse.json({ error: "Choose a paid plan." }, { status: 400 });
  }

  const priceId = checkoutStripePriceId(tier);
  if (!priceId) {
    const envName = checkoutPriceEnvName(tier);
    console.error(`[billing] checkout missing ${envName} for ${tier}`);
    return NextResponse.json(
      { error: `The ${PLANS[tier].name} plan isn't available yet.` },
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
    const session = await stripe.checkout.sessions.create(
      planCheckoutSessionParams({
        customerId,
        priceId,
        origin,
        userId: user.id,
        tier,
      })
    );

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
