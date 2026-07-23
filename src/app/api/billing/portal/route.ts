import { NextResponse } from "next/server";
import { isBillingUiEnabled } from "@/lib/billing/feature-flag";
import { reconcileUserSubscription } from "@/lib/billing/subscription";
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

  // Heal stale test-mode / deleted Stripe ids before opening the portal.
  const sub = await reconcileUserSubscription(user.id);
  if (!sub.stripeCustomerId) {
    return NextResponse.json(
      {
        error:
          sub.tier === "free"
            ? "You're already on the Free plan — no billing account to manage."
            : "No billing account yet — upgrade to a paid plan first.",
      },
      { status: 400 }
    );
  }

  try {
    const origin = originFromRequest(request);
    const stripe = getStripe();
    const session = await stripe.billingPortal.sessions.create({
      customer: sub.stripeCustomerId,
      return_url: `${origin}/dashboard/profile?tab=billing`,
    });
    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("[billing] portal failed", err);
    const message =
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code?: string }).code === "resource_missing"
        ? "Your billing account is out of date. Refresh this page and try again."
        : "Could not open the billing portal. Try again.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
