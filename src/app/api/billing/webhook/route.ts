import { NextResponse } from "next/server";
import type Stripe from "stripe";
import {
  markSubscriptionCanceled,
  subscriptionIdFromInvoice,
  syncFromCheckoutSession,
  syncStripeSubscription,
} from "@/lib/billing/sync-subscription";
import { refreshConnectAccountFromStripe } from "@/lib/marketplace/connect";
import { completeCoursePurchaseFromCheckout } from "@/lib/marketplace/purchases";
import { getStripe, isStripeConfigured } from "@/lib/stripe/client";

export const runtime = "nodejs";

/**
 * Stripe webhook — signature-verified source of truth for subscription state.
 * Rejects unsigned/invalid payloads. Writes tier/status to Supabase via the
 * service-role key only; clients never supply tier data.
 */
export async function POST(request: Request) {
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 503 });
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) {
    console.error("[billing] STRIPE_WEBHOOK_SECRET is not set");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const rawBody = await request.text();
  let event: Stripe.Event;

  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    console.error("[billing] webhook signature verification failed", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    await handleStripeEvent(event);
  } catch (err) {
    console.error("[billing] webhook handler error", event.type, err);
    return NextResponse.json({ error: "Handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function handleStripeEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode === "subscription") {
        await syncFromCheckoutSession(session);
      } else if (session.mode === "payment") {
        await completeCoursePurchaseFromCheckout(session);
      }
      break;
    }

    case "account.updated": {
      const account = event.data.object as Stripe.Account;
      await refreshConnectAccountFromStripe(account.id);
      break;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      await syncStripeSubscription(sub);
      break;
    }

    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      await markSubscriptionCanceled({ subscription: sub });
      break;
    }

    case "invoice.payment_failed":
    case "invoice.paid": {
      const invoice = event.data.object as Stripe.Invoice;
      const subscriptionId = subscriptionIdFromInvoice(invoice);
      if (!subscriptionId) break;
      const stripe = getStripe();
      const sub = await stripe.subscriptions.retrieve(subscriptionId);
      await syncStripeSubscription(sub);
      break;
    }

    default:
      break;
  }
}
