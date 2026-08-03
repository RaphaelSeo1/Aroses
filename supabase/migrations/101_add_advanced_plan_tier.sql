-- Add Advanced plan tier between Student and Premium.
-- Caps mirror src/lib/billing/plans.ts (5 courses, 10 lecture recordings).

alter table public.user_subscriptions
  drop constraint if exists user_subscriptions_tier_check;

alter table public.user_subscriptions
  add constraint user_subscriptions_tier_check
  check (tier in ('free', 'student', 'advanced', 'premium'));

create or replace function public.enforce_course_creation_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tier text;
  v_cap int;
  v_used int;
begin
  if to_regclass('public.app_super_admins') is not null
     and exists (
       select 1 from public.app_super_admins a where a.user_id = new.user_id
     ) then
    return new;
  end if;

  v_tier := public.plan_tier_for_user(new.user_id);
  v_cap := case v_tier
    when 'student' then 2
    when 'advanced' then 5
    when 'premium' then null
    else 1 -- free
  end;

  if v_cap is null then
    return new;
  end if;

  select count(*)::int into v_used
  from public.courses c
  where c.user_id = new.user_id;

  if v_used >= v_cap then
    raise exception 'course_cap_reached: plan allows % course(s)', v_cap
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create or replace function public.enforce_lecture_recording_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tier text;
  v_cap int;
  v_used int;
  v_period_start timestamptz;
begin
  if to_regclass('public.app_super_admins') is not null
     and exists (
       select 1 from public.app_super_admins a where a.user_id = new.user_id
     ) then
    return new;
  end if;

  v_tier := public.plan_tier_for_user(new.user_id);
  v_cap := case v_tier
    when 'student' then 5
    when 'advanced' then 10
    when 'premium' then 20
    else 1 -- free
  end;

  v_period_start := public.plan_period_start_for_user(new.user_id);

  begin
    select count(*)::int into v_used
    from public.live_lecture_sessions s
    where s.user_id = new.user_id
      and s.created_at >= v_period_start
      and s.deleted_at is null;
  exception
    when undefined_column then
      select count(*)::int into v_used
      from public.live_lecture_sessions s
      where s.user_id = new.user_id
        and s.created_at >= v_period_start;
  end;

  if coalesce(v_used, 0) >= v_cap then
    raise exception 'lecture_recording_cap_reached: plan allows % recording(s) this period', v_cap
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

comment on function public.enforce_course_creation_cap() is
  'Blocks course inserts past Free(1)/Student(2)/Advanced(5); Premium unlimited. Mirrors plans.ts.';
comment on function public.enforce_lecture_recording_cap() is
  'Blocks new live lecture sessions past Free(1)/Student(5)/Advanced(10)/Premium(20) per billing period.';
