-- Marketplace payments: Stripe Connect sellers + course purchase entitlements.

create table if not exists public.seller_payout_accounts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  stripe_account_id text not null unique,
  charges_enabled boolean not null default false,
  payouts_enabled boolean not null default false,
  details_submitted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists seller_payout_accounts_stripe_idx
  on public.seller_payout_accounts (stripe_account_id);

comment on table public.seller_payout_accounts is
  'Stripe Connect Express accounts for marketplace sellers. Written by server (webhook/service role).';

alter table public.seller_payout_accounts enable row level security;

create policy "Sellers read own payout account"
  on public.seller_payout_accounts
  for select
  to authenticated
  using (auth.uid() = user_id);

create table if not exists public.course_purchases (
  id uuid primary key default gen_random_uuid(),
  buyer_user_id uuid not null references auth.users (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  seller_user_id uuid not null references auth.users (id) on delete cascade,
  price_cents integer not null check (price_cents >= 99),
  currency text not null default 'usd' check (char_length(currency) = 3),
  platform_fee_cents integer not null default 0 check (platform_fee_cents >= 0),
  stripe_checkout_session_id text not null unique,
  stripe_payment_intent_id text,
  status text not null default 'pending'
    check (status in ('pending', 'completed', 'refunded')),
  purchased_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists course_purchases_buyer_course_completed_idx
  on public.course_purchases (buyer_user_id, course_id)
  where status = 'completed';

create index if not exists course_purchases_course_idx
  on public.course_purchases (course_id, status);

create index if not exists course_purchases_seller_idx
  on public.course_purchases (seller_user_id, purchased_at desc nulls last);

comment on table public.course_purchases is
  'One-time course purchases. Entitlement source for paid marketplace access.';

alter table public.course_purchases enable row level security;

create policy "Buyers read own course purchases"
  on public.course_purchases
  for select
  to authenticated
  using (auth.uid() = buyer_user_id);

create policy "Sellers read purchases of their courses"
  on public.course_purchases
  for select
  to authenticated
  using (auth.uid() = seller_user_id);

-- Purchasers may read study content for courses they bought.
create policy "Purchasers read study materials for bought courses"
  on public.study_materials
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.course_purchases cp
      where cp.course_id = study_materials.course_id
        and cp.buyer_user_id = auth.uid()
        and cp.status = 'completed'
    )
  );

create policy "Purchasers read exam groups for bought courses"
  on public.exam_groups
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.course_purchases cp
      where cp.course_id = exam_groups.course_id
        and cp.buyer_user_id = auth.uid()
        and cp.status = 'completed'
    )
  );

do $$
begin
  if exists (
    select 1 from pg_proc where proname = 'is_app_super_admin'
  ) then
    execute $pol$
      create policy "app_super_admins_all_seller_payout_accounts"
        on public.seller_payout_accounts
        for all
        using (public.is_app_super_admin())
        with check (public.is_app_super_admin())
    $pol$;
    execute $pol$
      create policy "app_super_admins_all_course_purchases"
        on public.course_purchases
        for all
        using (public.is_app_super_admin())
        with check (public.is_app_super_admin())
    $pol$;
  end if;
end $$;
