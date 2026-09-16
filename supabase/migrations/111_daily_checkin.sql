-- 111_daily_checkin.sql
--
-- Daily check-in (first rewards loop). One row per user. Writes go through
-- the service-role API so streaks and the 30-day Plus grant cannot be spoofed.
--
-- Streaks use the user's local calendar day (IANA timezone stored on the row).
-- Missing a local day resets current_streak; longest_streak is kept.
--
-- Hitting 30 consecutive days grants one month of Plus via user_subscriptions
-- (admin_granted + grant_source = 'checkin'), the same comp path as an admin
-- grant so it is excluded from paying MRR. Stripe Plus/Advanced/Premium is
-- never overwritten.

create table if not exists public.user_daily_checkins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  last_checkin_date date not null,
  last_checkin_at timestamptz not null default now(),
  timezone text not null default 'UTC',
  current_streak int not null default 1
    check (current_streak >= 0),
  longest_streak int not null default 1
    check (longest_streak >= 0),
  total_checkins int not null default 1
    check (total_checkins >= 0),
  plus_grants int not null default 0
    check (plus_grants >= 0),
  last_plus_granted_on_date date,
  last_plus_granted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_daily_checkins_last_at_idx
  on public.user_daily_checkins (last_checkin_at desc);

alter table public.user_daily_checkins enable row level security;

drop policy if exists "Users read own daily checkin" on public.user_daily_checkins;
create policy "Users read own daily checkin"
  on public.user_daily_checkins
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- No insert/update/delete policies: authenticated clients cannot write.
-- /api/checkin uses the service-role key after verifying the session.

create or replace function public.set_user_daily_checkins_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_daily_checkins_set_updated_at on public.user_daily_checkins;
create trigger user_daily_checkins_set_updated_at
  before update on public.user_daily_checkins
  for each row
  execute function public.set_user_daily_checkins_updated_at();

comment on table public.user_daily_checkins is
  'Per-user daily check-in streak. Local calendar day; service-role writes only.';

alter table public.user_subscriptions
  add column if not exists grant_source text;

alter table public.user_subscriptions
  drop constraint if exists user_subscriptions_grant_source_check;

alter table public.user_subscriptions
  add constraint user_subscriptions_grant_source_check
  check (grant_source is null or grant_source in ('admin', 'checkin'));

comment on column public.user_subscriptions.grant_source is
  'Who set an admin_granted tier: admin UI, or the 30-day check-in Plus reward. Null for Stripe-managed rows.';
