import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe/client";

export type SellerPayoutAccount = {
  userId: string;
  stripeAccountId: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
};

export function sellerCanReceivePayments(account: SellerPayoutAccount | null): boolean {
  return Boolean(account?.chargesEnabled && account?.detailsSubmitted);
}

export async function fetchSellerPayoutAccount(
  supabase: SupabaseClient,
  userId: string
): Promise<SellerPayoutAccount | null> {
  const { data } = await supabase
    .from("seller_payout_accounts")
    .select(
      "user_id, stripe_account_id, charges_enabled, payouts_enabled, details_submitted"
    )
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return null;
  return {
    userId: data.user_id,
    stripeAccountId: data.stripe_account_id,
    chargesEnabled: data.charges_enabled,
    payoutsEnabled: data.payouts_enabled,
    detailsSubmitted: data.details_submitted,
  };
}

export function payoutAccountFromStripe(
  userId: string,
  account: Stripe.Account
): SellerPayoutAccount {
  return {
    userId,
    stripeAccountId: account.id,
    chargesEnabled: account.charges_enabled ?? false,
    payoutsEnabled: account.payouts_enabled ?? false,
    detailsSubmitted: account.details_submitted ?? false,
  };
}

/** Upsert Connect account status (service role). */
export async function syncSellerPayoutAccount(
  row: SellerPayoutAccount
): Promise<void> {
  const admin = createAdminClient();
  if (!admin) {
    throw new Error("Admin client not configured");
  }
  const now = new Date().toISOString();
  const { error } = await admin.from("seller_payout_accounts").upsert(
    {
      user_id: row.userId,
      stripe_account_id: row.stripeAccountId,
      charges_enabled: row.chargesEnabled,
      payouts_enabled: row.payoutsEnabled,
      details_submitted: row.detailsSubmitted,
      updated_at: now,
    },
    { onConflict: "user_id" }
  );
  if (error) throw error;
}

export async function getOrCreateConnectAccount(opts: {
  userId: string;
  email: string | null;
}): Promise<string> {
  const admin = createAdminClient();
  if (!admin) {
    throw new Error("Admin client not configured");
  }

  const { data: existing } = await admin
    .from("seller_payout_accounts")
    .select("stripe_account_id")
    .eq("user_id", opts.userId)
    .maybeSingle();

  if (existing?.stripe_account_id) {
    return existing.stripe_account_id;
  }

  const stripe = getStripe();
  const account = await stripe.accounts.create({
    type: "express",
    country: process.env.STRIPE_CONNECT_DEFAULT_COUNTRY?.trim() || "US",
    email: opts.email ?? undefined,
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
    metadata: { user_id: opts.userId },
  });

  await syncSellerPayoutAccount(
    payoutAccountFromStripe(opts.userId, account)
  );

  return account.id;
}

export async function refreshConnectAccountFromStripe(
  stripeAccountId: string
): Promise<SellerPayoutAccount | null> {
  const admin = createAdminClient();
  if (!admin) return null;

  const { data: row } = await admin
    .from("seller_payout_accounts")
    .select("user_id")
    .eq("stripe_account_id", stripeAccountId)
    .maybeSingle();
  if (!row) return null;

  const stripe = getStripe();
  const account = await stripe.accounts.retrieve(stripeAccountId);
  const synced = payoutAccountFromStripe(row.user_id, account);
  await syncSellerPayoutAccount(synced);
  return synced;
}
