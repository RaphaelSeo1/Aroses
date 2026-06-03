import { NextResponse } from "next/server";
import { isBillingUiEnabled } from "@/lib/billing/feature-flag";
import { getUserSubscription } from "@/lib/billing/subscription";
import { getStripe, isStripeConfigured, originFromRequest } from "@/lib/stripe/client";
import { createRouteHandlerSupabase } from "@/lib/supabase/route-handler-client";

export const runtime = "nodejs";

/** Open the Stripe-hosted Billing Portal so users can manage or cancel. */
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
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  const sub = await getUserSubscription(user.id);
  if (!sub.stripeCustomerId) {
    return NextResponse.json(
      { error: "No billing account yet — upgrade to a paid plan first." },
      { status: 400 }
    );
  }

  try {
    const origin = originFromRequest(request);
    const stripe = getStripe();
    const session = await stripe.billingPortal.sessions.create({
      customer: sub.stripeCustomerId,
      return_url: `${origin}/dashboard/billing`,
    });
    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("[billing] portal failed", err);
    return NextResponse.json(
      { error: "Could not open the billing portal. Try again." },
      { status: 500 }
    );
  }
}
