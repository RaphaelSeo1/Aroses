import { NextResponse } from "next/server";
import { marketplaceApiUnavailable } from "@/lib/marketplace/api-guard";
import { fetchSellerPayoutAccount } from "@/lib/marketplace/connect";
import { isMarketplacePaymentsEnabled } from "@/lib/marketplace/platform-fee";
import { getStripe, isStripeConfigured } from "@/lib/stripe/client";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Open the seller's Stripe Express dashboard (balances, payouts, bank details).
 * Money already lands on Express automatically; this is where they track /
 * manage withdrawals — Aroses does not approve each payout.
 */
export async function POST() {
  const blocked = marketplaceApiUnavailable();
  if (blocked) return blocked;

  if (!isStripeConfigured() || !isMarketplacePaymentsEnabled()) {
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
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  const account = await fetchSellerPayoutAccount(supabase, user.id);
  if (!account?.stripeAccountId) {
    return NextResponse.json(
      {
        error:
          "Set up payouts first from a course’s settings, then you can open Stripe here.",
      },
      { status: 400 }
    );
  }

  try {
    const stripe = getStripe();
    const link = await stripe.accounts.createLoginLink(account.stripeAccountId);
    if (!link.url) {
      throw new Error("Stripe did not return a login link.");
    }
    return NextResponse.json({ url: link.url });
  } catch (err) {
    console.error("[marketplace] express login link failed", err);
    return NextResponse.json(
      {
        error:
          "Could not open Stripe payouts. Finish payout setup on a course, then try again.",
      },
      { status: 500 }
    );
  }
}
