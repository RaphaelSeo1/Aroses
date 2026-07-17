/**
 * Master switch for paid plans and billing UI across the site.
 *
 * Set `BILLING_UI_ENABLED` to `true` when you want checkout, the billing page,
 * and upgrade links visible again. Everything else (Stripe webhooks, Supabase
 * `user_subscriptions`, voice metering, API routes) stays in place — only
 * student-facing surfaces are hidden.
 */

export const BILLING_UI_ENABLED = true;

export function isBillingUiEnabled(): boolean {
  return BILLING_UI_ENABLED;
}
