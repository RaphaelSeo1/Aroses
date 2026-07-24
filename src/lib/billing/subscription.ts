import "server-only";
import type Stripe from "stripe";
import { isStripeConfigured, getStripe } from "@/lib/stripe/client";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PlanTier } from "@/lib/billing/plans";
import { syncStripeSubscription } from "@/lib/billing/sync-subscription";

export type UserSubscription = {
  tier: PlanTier;
  status: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  /** True when an app admin set tier/status (not Stripe). */
  adminGranted: boolean;
};

const FREE_SUBSCRIPTION: UserSubscription = {
  tier: "free",
  status: "inactive",
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  currentPeriodStart: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  adminGranted: false,
};

type SubscriptionRow = {
  tier: PlanTier;
  status: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  admin_granted?: boolean | null;
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
    adminGranted: Boolean(row.admin_granted),
  };
}

export const ADMIN_SUBSCRIPTION_STATUSES = [
  "inactive",
  "active",
  "trialing",
  "past_due",
  "canceled",
] as const;

export type AdminSubscriptionStatus =
  (typeof ADMIN_SUBSCRIPTION_STATUSES)[number];

function isStripeResourceMissing(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "resource_missing"
  );
}

const ACTIVE_SUB_STATUSES = new Set([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "incomplete",
]);

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
      "tier, status, stripe_customer_id, stripe_subscription_id, current_period_start, current_period_end, cancel_at_period_end, admin_granted"
    )
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    // Pre-migration DBs may lack admin_granted — fall back without it.
    if (/admin_granted|schema cache/i.test(error.message ?? "")) {
      const legacy = await admin
        .from("user_subscriptions")
        .select(
          "tier, status, stripe_customer_id, stripe_subscription_id, current_period_start, current_period_end, cancel_at_period_end"
        )
        .eq("user_id", userId)
        .maybeSingle();
      if (legacy.error || !legacy.data) return FREE_SUBSCRIPTION;
      return rowToSubscription(legacy.data as SubscriptionRow);
    }
    return FREE_SUBSCRIPTION;
  }
  if (!data) return FREE_SUBSCRIPTION;
  return rowToSubscription(data as SubscriptionRow);
}

/** Reset local billing state to free (keeps optional live customer id). */
async function writeFreeSubscription(
  userId: string,
  opts?: { stripeCustomerId?: string | null }
): Promise<void> {
  const admin = createAdminClient();
  if (!admin) return;
  const { error } = await admin.from("user_subscriptions").upsert(
    {
      user_id: userId,
      tier: "free",
      status: "inactive",
      stripe_customer_id: opts?.stripeCustomerId ?? null,
      stripe_subscription_id: null,
      current_period_start: null,
      current_period_end: null,
      cancel_at_period_end: false,
      admin_granted: false,
    },
    { onConflict: "user_id" }
  );
  if (error) {
    console.error("[billing] reset to free failed", error);
    throw error;
  }
}

/**
 * Verify local subscription state against the current Stripe mode (test vs live).
 * Fixes stuck paid tiers when the DB still points at test-mode (or deleted)
 * customers/subscriptions after a key switch — the usual cause of a broken
 * billing portal after marketplace purchases that never touch subscriptions.
 */
export async function reconcileUserSubscription(
  userId: string
): Promise<UserSubscription> {
  const local = await getUserSubscription(userId);
  if (!isStripeConfigured()) return local;

  // Admin-granted tiers are intentional and must not be wiped when Stripe
  // has no matching subscription.
  if (local.adminGranted) return local;

  const needsCheck =
    Boolean(local.stripeCustomerId) ||
    Boolean(local.stripeSubscriptionId) ||
    local.tier !== "free";
  if (!needsCheck) return local;

  const stripe = getStripe();
  let customerId = local.stripeCustomerId;

  if (customerId) {
    try {
      const customer = await stripe.customers.retrieve(customerId);
      if (customer.deleted) {
        await writeFreeSubscription(userId);
        return FREE_SUBSCRIPTION;
      }
    } catch (err) {
      if (!isStripeResourceMissing(err)) {
        console.error("[billing] reconcile: customer retrieve failed", err);
        return local;
      }
      // Stale id from the other Stripe mode (or deleted customer).
      console.warn(
        "[billing] reconcile: clearing stale Stripe customer",
        customerId
      );
      await writeFreeSubscription(userId);
      return FREE_SUBSCRIPTION;
    }
  }

  if (local.stripeSubscriptionId) {
    try {
      const sub = await stripe.subscriptions.retrieve(local.stripeSubscriptionId);
      await syncStripeSubscription(sub, { userId });
      return getUserSubscription(userId);
    } catch (err) {
      if (!isStripeResourceMissing(err)) {
        console.error("[billing] reconcile: subscription retrieve failed", err);
        return local;
      }
      console.warn(
        "[billing] reconcile: missing subscription id",
        local.stripeSubscriptionId
      );
    }
  }

  if (customerId) {
    try {
      const listed = await stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: 10,
      });
      const live = pickLiveSubscription(listed.data);
      if (live) {
        await syncStripeSubscription(live, { userId });
        return getUserSubscription(userId);
      }
    } catch (err) {
      console.error("[billing] reconcile: list subscriptions failed", err);
      return local;
    }
  }

  // Paid (or formerly subscribed) locally, but nothing live in Stripe.
  if (local.tier !== "free" || local.stripeSubscriptionId) {
    await writeFreeSubscription(userId, { stripeCustomerId: customerId });
    return getUserSubscription(userId);
  }

  return local;
}

function pickLiveSubscription(
  subs: Stripe.Subscription[]
): Stripe.Subscription | null {
  const ranked = [...subs].sort((a, b) => b.created - a.created);
  return (
    ranked.find((s) => ACTIVE_SUB_STATUSES.has(s.status)) ??
    ranked.find((s) => s.status === "canceled") ??
    null
  );
}

/**
 * Return the user's Stripe customer id, creating the customer (and the local
 * subscription row) on first use. Called from the checkout route so a customer
 * always exists before a Checkout Session is created.
 *
 * If the stored customer id is from the wrong Stripe mode (or deleted), we
 * clear it and create a fresh live/test customer for the current key.
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

  const stripe = getStripe();
  const existingId = existing?.stripe_customer_id ?? null;

  if (existingId) {
    try {
      const customer = await stripe.customers.retrieve(existingId);
      if (!customer.deleted) return existingId;
    } catch (err) {
      if (!isStripeResourceMissing(err)) throw err;
      console.warn(
        "[billing] replacing stale Stripe customer before checkout",
        existingId
      );
      await writeFreeSubscription(opts.userId);
    }
  }

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

/**
 * Admin override: set a user's plan tier/status in `user_subscriptions`.
 * Paid tiers are marked `admin_granted` so Stripe reconcile won't reset them.
 * Does not create or cancel Stripe subscriptions.
 */
export async function adminSetUserSubscription(opts: {
  userId: string;
  tier: PlanTier;
  status: AdminSubscriptionStatus;
}): Promise<UserSubscription> {
  const admin = createAdminClient();
  if (!admin) {
    throw new Error("Service role key not configured — cannot update subscription.");
  }

  const { data: existing } = await admin
    .from("user_subscriptions")
    .select("stripe_customer_id")
    .eq("user_id", opts.userId)
    .maybeSingle();
  const customerId =
    typeof existing?.stripe_customer_id === "string"
      ? existing.stripe_customer_id
      : null;

  if (opts.tier === "free") {
    await writeFreeSubscription(opts.userId, { stripeCustomerId: customerId });
    // Honor an explicit canceled/inactive status label when demoting.
    if (opts.status !== "inactive") {
      await admin
        .from("user_subscriptions")
        .update({ status: opts.status, admin_granted: false })
        .eq("user_id", opts.userId);
    }
    return getUserSubscription(opts.userId);
  }

  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setUTCDate(periodEnd.getUTCDate() + 30);

  const { error } = await admin.from("user_subscriptions").upsert(
    {
      user_id: opts.userId,
      tier: opts.tier,
      status: opts.status,
      stripe_customer_id: customerId,
      // Clear Stripe sub id so webhooks don't fight the admin grant until
      // the user checks out again (checkout creates a fresh sub + sync).
      stripe_subscription_id: null,
      current_period_start: now.toISOString(),
      current_period_end: periodEnd.toISOString(),
      cancel_at_period_end: false,
      admin_granted: true,
    },
    { onConflict: "user_id" }
  );

  if (error) {
    console.error("[billing] admin set subscription failed", error);
    throw error;
  }

  return getUserSubscription(opts.userId);
}
