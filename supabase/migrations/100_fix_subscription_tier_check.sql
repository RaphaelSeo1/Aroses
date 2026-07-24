-- Production DBs that created user_subscriptions before 053 (or with a
-- different tier list) can keep a stale user_subscriptions_tier_check that
-- rejects 'student' / 'premium'. Align the constraint with PlanTier.

alter table public.user_subscriptions
  drop constraint if exists user_subscriptions_tier_check;

-- Normalize any legacy labels before re-adding the check.
update public.user_subscriptions
set tier = case lower(trim(tier))
  when 'student' then 'student'
  when 'premium' then 'premium'
  when 'pro' then 'premium'
  when 'plus' then 'student'
  when 'basic' then 'free'
  when 'free' then 'free'
  else 'free'
end
where tier is distinct from case lower(trim(tier))
  when 'student' then 'student'
  when 'premium' then 'premium'
  when 'pro' then 'premium'
  when 'plus' then 'student'
  when 'basic' then 'free'
  when 'free' then 'free'
  else 'free'
end;

alter table public.user_subscriptions
  add constraint user_subscriptions_tier_check
  check (tier in ('free', 'student', 'premium'));

-- Ensure admin grant column exists (safe if 099 already applied).
alter table public.user_subscriptions
  add column if not exists admin_granted boolean not null default false;
