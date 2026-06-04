import Stripe from "stripe";

/** Map Connect onboarding failures to user-actionable copy (no secrets). */
export function connectOnboardErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message === "Admin client not configured") {
    return "Server is missing SUPABASE_SERVICE_ROLE_KEY — add it in Vercel env vars.";
  }

  if (err instanceof Stripe.errors.StripeError) {
    const msg = err.message ?? "";
    if (/signed up for Connect/i.test(msg)) {
      return "Stripe Connect is not enabled on your Stripe account yet. Open dashboard.stripe.com/connect to complete platform setup, then try again.";
    }
    if (/livemode/i.test(msg) && /test/i.test(msg)) {
      return "Stripe key mode mismatch — use test keys for local dev and live keys for production.";
    }
    if (msg) return msg;
  }

  if (err && typeof err === "object" && "message" in err) {
    const msg = String((err as { message: unknown }).message);
    if (/seller_payout_accounts/i.test(msg) && /does not exist/i.test(msg)) {
      return "Database migration 058_marketplace_payments.sql has not been applied yet.";
    }
    if (/Admin client not configured/i.test(msg)) {
      return "Server is missing SUPABASE_SERVICE_ROLE_KEY — add it in Vercel env vars.";
    }
    if (msg) return msg;
  }

  return "Could not start payout setup. Try again.";
}
