import "server-only";
import type Stripe from "stripe";
import {
  isTierCheckViolation,
  preMigrationTierValue,
  tierForPriceId,
  type PlanTier,
} from "@/lib/billing/plans";
import { getStripe } from "@/lib/stripe/client";
import { createAdminClient } from "@/lib/supabase/admin";

/** Map a Stripe subscription status + price to our internal tier. */
export function tierFromStripeSubscription(sub: Stripe.Subscription): PlanTier {
  if (sub.status === "canceled" || sub.status === "incomplete_expired") {
    return "free";
  }
  const priceId = sub.items.data[0]?.price?.id ?? null;
  return tierForPriceId(priceId) ?? "free";
}

function customerIdFrom(
  customer: Stripe.Subscription["customer"] | Stripe.Checkout.Session["customer"]
): string | null {
  if (!customer) return null;
  return typeof customer === "string" ? customer : customer.id;
}

/** Billing period timestamps (Stripe v22+: on the first subscription item). */
function billingPeriodFromSubscription(sub: Stripe.Subscription): {
  startIso: string | null;
  endIso: string | null;
} {
  const item = sub.items.data[0];
  const start = item?.current_period_start ?? null;
  const end = item?.current_period_end ?? null;
  return {
    startIso: start ? new Date(start * 1000).toISOString() : null,
    endIso: end ? new Date(end * 1000).toISOString() : null,
  };
}

/** Subscription id on invoice objects (field location varies by Stripe API version). */
export function subscriptionIdFromInvoice(
  invoice: Stripe.Invoice
): string | null {
  const parent = (
    invoice as Stripe.Invoice & {
      parent?: {
        subscription_details?: {
          subscription?: string | { id: string } | null;
        };
      };
    }
  ).parent;
  const fromParent = parent?.subscription_details?.subscription;
  if (fromParent) {
    return typeof fromParent === "string" ? fromParent : fromParent.id;
  }

  const legacy = (
    invoice as Stripe.Invoice & {
      subscription?: string | { id: string } | null;
    }
  ).subscription;
  if (legacy) {
    return typeof legacy === "string" ? legacy : legacy.id;
  }

  const line = invoice.lines?.data?.[0] as
    | {
        parent?: {
          subscription_item_details?: { subscription?: string | null };
        };
      }
    | undefined;
  return line?.parent?.subscription_item_details?.subscription ?? null;
}

/**
 * Resolve the Supabase user id from webhook metadata, our DB, or the Stripe
 * customer record. Never trust client-supplied tier — only this id + Stripe
 * objects drive writes.
 */
export async function resolveBillingUserId(opts: {
  userId?: string | null;
  customerId?: string | null;
  subscription?: Stripe.Subscription | null;
}): Promise<string | null> {
  const direct =
    opts.userId?.trim() ||
    opts.subscription?.metadata?.user_id?.trim() ||
    null;
  if (direct) return direct;

  const customerId =
    opts.customerId ??
    (opts.subscription ? customerIdFrom(opts.subscription.customer) : null);
  if (!customerId) return null;

  const admin = createAdminClient();
  if (admin) {
    const { data } = await admin
      .from("user_subscriptions")
      .select("user_id")
      .eq("stripe_customer_id", customerId)
      .maybeSingle();
    if (data?.user_id) return data.user_id as string;
  }

  try {
    const stripe = getStripe();
    const customer = await stripe.customers.retrieve(customerId);
    if (!customer.deleted && customer.metadata?.user_id?.trim()) {
      return customer.metadata.user_id.trim();
    }
  } catch (err) {
    console.error("[billing] resolve user: customer retrieve failed", err);
  }

  return null;
}

/** Upsert subscription state from a Stripe Subscription object (webhook source of truth). */
export async function syncStripeSubscription(
  sub: Stripe.Subscription,
  opts?: { userId?: string | null }
): Promise<void> {
  const admin = createAdminClient();
  if (!admin) {
    throw new Error("Service role key not configured — cannot sync subscription.");
  }

  const userId = await resolveBillingUserId({
    userId: opts?.userId,
    subscription: sub,
  });
  if (!userId) {
    console.error("[billing] sync subscription: no user_id", { subscriptionId: sub.id });
    return;
  }

  const tier = tierFromStripeSubscription(sub);
  const customerId = customerIdFrom(sub.customer);
  const { startIso, endIso } = billingPeriodFromSubscription(sub);

  const row = await upsertSyncedRow(admin, {
    userId,
    tier,
    status: sub.status,
    customerId,
    subscriptionId: sub.id,
    startIso,
    endIso,
    cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
  });
  if (row.error) {
    console.error("[billing] sync subscription upsert failed", row.error);
    throw row.error;
  }
}

type SyncedRow = {
  userId: string;
  tier: PlanTier;
  status: string;
  customerId: string | null;
  subscriptionId: string;
  startIso: string | null;
  endIso: string | null;
  cancelAtPeriodEnd: boolean;
};

/**
 * Writes the row, retrying without `grant_source` on older schemas and with
 * a legacy tier name while migration 118 (lite/pro/max) isn't applied.
 */
async function upsertSyncedRow(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  input: SyncedRow
): Promise<{ error: { code?: string; message?: string } | null }> {
  const write = async (tierValue: string, withGrantSource: boolean) => {
    const { error } = await admin.from("user_subscriptions").upsert(
      {
        user_id: input.userId,
        tier: tierValue,
        status: input.status,
        stripe_customer_id: input.customerId,
        stripe_subscription_id: input.subscriptionId,
        current_period_start: input.startIso,
        current_period_end: input.endIso,
        cancel_at_period_end: input.cancelAtPeriodEnd,
        // Real Stripe billing takes over any previous admin / check-in grant.
        admin_granted: false,
        ...(withGrantSource ? { grant_source: null } : {}),
      },
      { onConflict: "user_id" }
    );
    return error;
  };

  let withGrantSource = true;
  let error = await write(input.tier, withGrantSource);
  if (error && /grant_source|schema cache/i.test(error.message ?? "")) {
    withGrantSource = false;
    error = await write(input.tier, withGrantSource);
  }
  const standIn = preMigrationTierValue(input.tier);
  if (error && isTierCheckViolation(error) && standIn !== input.tier) {
    console.warn(
      `[billing] tier "${input.tier}" not allowed yet (apply migration 118_plan_tiers_v2.sql); stored as "${standIn}"`
    );
    error = await write(standIn, withGrantSource);
  }
  return { error };
}

/** Mark a user as free after subscription deletion. */
export async function markSubscriptionCanceled(opts: {
  subscription: Stripe.Subscription;
  userId?: string | null;
}): Promise<void> {
  const admin = createAdminClient();
  if (!admin) {
    throw new Error("Service role key not configured — cannot sync subscription.");
  }

  const userId = await resolveBillingUserId({
    userId: opts.userId,
    subscription: opts.subscription,
  });
  if (!userId) {
    console.error("[billing] cancel sync: no user_id", {
      subscriptionId: opts.subscription.id,
    });
    return;
  }

  const customerId = customerIdFrom(opts.subscription.customer);

  const { error } = await admin.from("user_subscriptions").upsert(
    {
      user_id: userId,
      tier: "free",
      status: "canceled",
      stripe_customer_id: customerId,
      stripe_subscription_id: null,
      current_period_start: null,
      current_period_end: null,
      cancel_at_period_end: false,
      admin_granted: false,
      grant_source: null,
    },
    { onConflict: "user_id" }
  );

  if (error && /grant_source|schema cache/i.test(error.message ?? "")) {
    const retry = await admin.from("user_subscriptions").upsert(
      {
        user_id: userId,
        tier: "free",
        status: "canceled",
        stripe_customer_id: customerId,
        stripe_subscription_id: null,
        current_period_start: null,
        current_period_end: null,
        cancel_at_period_end: false,
        admin_granted: false,
      },
      { onConflict: "user_id" }
    );
    if (retry.error) {
      console.error("[billing] cancel sync upsert failed", retry.error);
      throw retry.error;
    }
    return;
  }

  if (error) {
    console.error("[billing] cancel sync upsert failed", error);
    throw error;
  }
}

/** After checkout completes, fetch the subscription and sync (covers race with subscription.* events). */
export async function syncFromCheckoutSession(
  session: Stripe.Checkout.Session
): Promise<void> {
  const userId =
    session.metadata?.user_id?.trim() ||
    session.client_reference_id?.trim() ||
    null;

  const subscriptionId =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription?.id;

  if (!subscriptionId) return;

  const stripe = getStripe();
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  await syncStripeSubscription(sub, { userId });
}
