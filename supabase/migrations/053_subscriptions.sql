-- Stripe subscription state, mirrored into Supabase as the source of truth for
-- a user's tier and limits.
--
-- One row per user (created lazily when they first start checkout / when the
-- Stripe webhook first fires). A user with NO row is implicitly on the free
-- tier. The row is written ONLY by trusted server code:
--   - checkout route (service-role key) stores the Stripe customer id
--   - the signature-verified Stripe webhook (service-role key) writes tier,
--     status, and billing-period fields
-- Clients can read their own row but can never write it (no insert/update
-- policy), so tier/status can't be spoofed from the browser.

create table if not exists public.user_subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tier text not null default 'free'
    check (tier in ('free', 'student', 'premium')),
  -- Mirrors Stripe subscription status: inactive | active | trialing |
  -- past_due | canceled | incomplete | incomplete_expired | unpaid.
  status text not null default 'inactive',
  stripe_customer_id text unique,
  stripe_subscription_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  updated_at timestamptz not null default now()
);

create index if not exists user_subscriptions_customer_idx
  on public.user_subscriptions (stripe_customer_id);

alter table public.user_subscriptions enable row level security;

-- Read-only for the owner; no write policies (server/webhook writes via the
-- service-role key, which bypasses RLS).
drop policy if exists "subscriptions_select_own" on public.user_subscriptions;
create policy "subscriptions_select_own"
  on public.user_subscriptions for select to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.set_user_subscriptions_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_subscriptions_set_updated_at on public.user_subscriptions;
create trigger user_subscriptions_set_updated_at
  before update on public.user_subscriptions
  for each row execute function public.set_user_subscriptions_updated_at();

comment on table public.user_subscriptions is
  'Per-user Stripe subscription state (tier/status/period). Source of truth for plan limits. Written only by trusted server code via the service-role key.';
