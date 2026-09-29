-- Plans v2 (2026-09): Lite / Student / Plus / Pro / Max, priced from measured
-- AI cost. Limits live in src/lib/billing/plans.ts.
--
-- 1. Allow the new tier names. The old names (basic / advanced / premium) stay
--    allowed so existing rows keep working; the app reads them as
--    basic → lite, advanced → plus, premium → pro. No rows are rewritten here:
--    the Stripe webhook re-syncs paid users onto the new names on their next
--    subscription event.
--
-- 2. Live lectures are now metered in recorded minutes (plan_meter_usage,
--    migration 119), enforced in the app and when issuing the Deepgram token.
--    The old trigger counted sessions with per-tier caps keyed on the old tier
--    names, so it would block every Lite / Pro / Max user. It now only blocks
--    unpaid accounts (same as before for free).
--
-- Until this is applied the app stores lite as 'basic' and pro / max as
-- 'premium' (see preMigrationTierValue), so Max reads as Pro until then.

alter table public.user_subscriptions
  drop constraint if exists user_subscriptions_tier_check;

alter table public.user_subscriptions
  add constraint user_subscriptions_tier_check
  check (tier in (
    'free', 'lite', 'student', 'plus', 'pro', 'max',
    'basic', 'advanced', 'premium'
  ));

create or replace function public.enforce_lecture_recording_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tier text;
begin
  if public.is_plan_cap_exempt(new.user_id) then
    return new;
  end if;

  v_tier := public.plan_tier_for_user(new.user_id);
  if v_tier in (
    'lite', 'student', 'plus', 'pro', 'max',
    'basic', 'advanced', 'premium'
  ) then
    return new;
  end if;

  raise exception 'lecture_recording_cap_reached: plan allows 0 lecture minutes this period'
    using errcode = 'P0001';
end;
$$;

comment on function public.enforce_lecture_recording_cap() is
  'Blocks new live lecture sessions for unpaid accounts. Paid plans are limited by recorded minutes (plan_meter_usage), enforced in the app.';
