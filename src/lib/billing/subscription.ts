import "server-only";
import { getStripe } from "@/lib/stripe/client";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PlanTier } from "@/lib/billing/plans";

export type UserSubscription = {
  tier: PlanTier;
  status: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
};

const FREE_SUBSCRIPTION: UserSubscription = {
  tier: "free",
  status: "inactive",
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  currentPeriodStart: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
};

type SubscriptionRow = {
  tier: PlanTier;
  status: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
};

function rowToSubscription(row: SubscriptionRow): UserSubscription {
  return {
    tier: row.tier ?? "free",
    status: row.status ?? "inactive",
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: row.cancel_at_period_end ?? false,
  };
}

/**
 * Read a user's subscription. A missing row (or unconfigured service role)
 * resolves to the free tier — we never throw here so callers can treat free as
 * the safe default.
 */
export async function getUserSubscription(
  userId: string
): Promise<UserSubscription> {
  const admin = createAdminClient();
  if (!admin) return FREE_SUBSCRIPTION;
  const { data, error } = await admin
    .from("user_subscriptions")
    .select(
      "tier, status, stripe_customer_id, stripe_subscription_id, current_period_start, current_period_end, cancel_at_period_end"
    )
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return FREE_SUBSCRIPTION;
  return rowToSubscription(data as SubscriptionRow);
}

/**
 * Return the user's Stripe customer id, creating the customer (and the local
 * subscription row) on first use. Called from the checkout route so a customer
 * always exists before a Checkout Session is created.
 */
export async function getOrCreateStripeCustomer(opts: {
  userId: string;
  email: string | null;
}): Promise<string> {
  const admin = createAdminClient();
  if (!admin) {
    throw new Error("Service role key not configured — cannot manage billing.");
  }

  const { data: existing } = await admin
    .from("user_subscriptions")
    .select("stripe_customer_id")
    .eq("user_id", opts.userId)
    .maybeSingle();
  if (existing?.stripe_customer_id) return existing.stripe_customer_id;

  const stripe = getStripe();
  const customer = await stripe.customers.create({
    email: opts.email ?? undefined,
    metadata: { user_id: opts.userId },
  });

  await admin
    .from("user_subscriptions")
    .upsert(
      { user_id: opts.userId, stripe_customer_id: customer.id },
      { onConflict: "user_id" }
    );

  return customer.id;
}
