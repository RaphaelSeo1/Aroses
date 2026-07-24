-- Allow admins to grant Student/Premium without a live Stripe subscription.
-- reconcileUserSubscription skips Stripe wipe when admin_granted is true;
-- Stripe webhook sync clears the flag so real billing takes over again.

alter table public.user_subscriptions
  add column if not exists admin_granted boolean not null default false;

comment on column public.user_subscriptions.admin_granted is
  'True when tier/status was set by an app admin (not Stripe). Protects against reconcile resetting to free.';
