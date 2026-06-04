import { NextResponse } from "next/server";
import {
  fetchSellerPayoutAccount,
  getOrCreateConnectAccount,
  refreshConnectAccountFromStripe,
  sellerCanReceivePayments,
} from "@/lib/marketplace/connect";
import { connectOnboardErrorMessage } from "@/lib/marketplace/connect-errors";
import { isMarketplacePaymentsEnabled } from "@/lib/marketplace/platform-fee";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe, isStripeConfigured, originFromRequest } from "@/lib/stripe/client";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** Start or resume Stripe Connect Express onboarding for marketplace sellers. */
export async function POST(request: Request) {
  if (!isMarketplacePaymentsEnabled() || !isStripeConfigured()) {
    return NextResponse.json(
      { error: "Marketplace payments are not configured yet." },
      { status: 503 }
    );
  }

  if (!createAdminClient()) {
    return NextResponse.json(
      {
        error:
          "Server is missing SUPABASE_SERVICE_ROLE_KEY — required to save payout accounts.",
      },
      { status: 503 }
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to connect payouts." }, { status: 401 });
  }

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    /* optional body */
  }
  const returnPath =
    typeof (body as { returnPath?: unknown }).returnPath === "string"
      ? (body as { returnPath: string }).returnPath
      : "/dashboard/courses";

  try {
    const accountId = await getOrCreateConnectAccount({
      userId: user.id,
      email: user.email ?? null,
    });

    await refreshConnectAccountFromStripe(accountId);

    const origin = originFromRequest(request);
    const returnUrl = `${origin}${returnPath.startsWith("/") ? returnPath : `/${returnPath}`}?connect=return`;
    const refreshUrl = `${origin}${returnPath.startsWith("/") ? returnPath : `/${returnPath}`}?connect=refresh`;

    const stripe = getStripe();
    const link = await stripe.accountLinks.create({
      account: accountId,
      type: "account_onboarding",
      return_url: returnUrl,
      refresh_url: refreshUrl,
    });

    if (!link.url) {
      throw new Error("Stripe did not return an onboarding URL.");
    }

    return NextResponse.json({ url: link.url });
  } catch (err) {
    console.error("[marketplace] connect onboard failed", err);
    return NextResponse.json(
      { error: connectOnboardErrorMessage(err) },
      { status: 500 }
    );
  }
}

/** Seller payout account status for dashboard UI. */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const account = await fetchSellerPayoutAccount(supabase, user.id);
  return NextResponse.json({
    configured: isMarketplacePaymentsEnabled(),
    account: account
      ? {
          chargesEnabled: account.chargesEnabled,
          payoutsEnabled: account.payoutsEnabled,
          detailsSubmitted: account.detailsSubmitted,
          ready: sellerCanReceivePayments(account),
        }
      : null,
  });
}
