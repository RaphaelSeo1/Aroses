-- Five public paid tiers (basic/student/plus/advanced/premium) plus internal
-- free. Usage ledger for AI course generations + source pages. Course-row
-- COUNT(*) caps are removed: empty shells are free; expensive generation is
-- reserved atomically. Lecture recordings count every started session in the
-- billing period (deletion does not restore quota).

-- ── Tier constraint ──────────────────────────────────────────────────────────
alter table public.user_subscriptions
  drop constraint if exists user_subscriptions_tier_check;

alter table public.user_subscriptions
  add constraint user_subscriptions_tier_check
  check (tier in ('free', 'basic', 'student', 'plus', 'advanced', 'premium'));

-- ── Ingest job snapshots ─────────────────────────────────────────────────────
alter table public.pdf_ingest_jobs
  add column if not exists billing_tier_snapshot text;

alter table public.pdf_ingest_jobs
  add column if not exists generation_depth text;

alter table public.pdf_ingest_jobs
  add column if not exists source_page_units integer;

alter table public.pdf_ingest_jobs
  add column if not exists usage_reservation_id uuid;

-- ── Usage ledger ─────────────────────────────────────────────────────────────
create table if not exists public.subscription_generation_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  billing_period_start timestamptz not null,
  billing_period_end timestamptz,
  tier_snapshot text not null default 'free',
  course_id uuid,
  job_id uuid,
  idempotency_key text not null,
  generation_reason text not null default 'initial'
    check (generation_reason in ('initial', 'additional_material', 'full_regeneration')),
  course_generation_units integer not null default 0
    check (course_generation_units >= 0),
  source_page_units integer not null default 0
    check (source_page_units >= 0),
  status text not null default 'reserved'
    check (status in ('reserved', 'completed', 'released')),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  released_at timestamptz
);

create unique index if not exists subscription_generation_usage_idempotency_idx
  on public.subscription_generation_usage (user_id, idempotency_key);

create unique index if not exists subscription_generation_usage_job_active_idx
  on public.subscription_generation_usage (job_id)
  where job_id is not null and status in ('reserved', 'completed');

create unique index if not exists subscription_generation_usage_initial_course_idx
  on public.subscription_generation_usage (course_id)
  where generation_reason = 'initial'
    and course_generation_units > 0
    and status in ('reserved', 'completed')
    and course_id is not null;

create index if not exists subscription_generation_usage_user_period_idx
  on public.subscription_generation_usage (user_id, billing_period_start, status);

alter table public.subscription_generation_usage enable row level security;

drop policy if exists subscription_generation_usage_select_own
  on public.subscription_generation_usage;
create policy subscription_generation_usage_select_own
  on public.subscription_generation_usage
  for select
  to authenticated
  using (auth.uid() = user_id);

comment on table public.subscription_generation_usage is
  'Billing-period AI course generation + source-page ledger. Deleting courses must never remove completed/reserved rows.';

-- ── Helpers ──────────────────────────────────────────────────────────────────
create or replace function public.subscription_usage_used(
  p_user_id uuid,
  p_period_start timestamptz
)
returns table (course_generation_units integer, source_page_units integer)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(sum(u.course_generation_units), 0)::int as course_generation_units,
    coalesce(sum(u.source_page_units), 0)::int as source_page_units
  from public.subscription_generation_usage u
  where u.user_id = p_user_id
    and u.billing_period_start = p_period_start
    and u.status in ('reserved', 'completed');
$$;

create or replace function public.get_subscription_generation_usage(
  p_user_id uuid,
  p_period_start timestamptz
)
returns table (course_generation_units integer, source_page_units integer)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return query select * from public.subscription_usage_used(p_user_id, p_period_start);
end;
$$;

create or replace function public.reserve_course_generation(
  p_user_id uuid,
  p_course_id uuid,
  p_job_id uuid,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_tier text,
  p_reason text,
  p_generation_units integer,
  p_idempotency_key text,
  p_cap integer
)
returns public.subscription_generation_usage
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.subscription_generation_usage;
  v_used int;
  v_units int;
  v_reason text;
begin
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  v_units := greatest(0, coalesce(p_generation_units, 0));
  v_reason := coalesce(nullif(p_reason, ''), 'initial');

  perform pg_advisory_xact_lock(
    hashtext(p_user_id::text),
    hashtext(coalesce(p_period_start::text, ''))
  );

  select u.* into v_row
  from public.subscription_generation_usage u
  where u.user_id = p_user_id
    and u.idempotency_key = p_idempotency_key
  limit 1;
  if found then
    if v_row.status = 'released' then
      if p_cap is not null then
        select s.course_generation_units into v_used
        from public.subscription_usage_used(p_user_id, p_period_start) s;
        if coalesce(v_used, 0) + greatest(0, coalesce(v_row.course_generation_units, 0)) > p_cap then
          raise exception 'course_generation_cap_reached: plan allows % generation(s)', p_cap
            using errcode = 'P0001';
        end if;
      end if;
      update public.subscription_generation_usage
        set status = 'reserved',
            released_at = null,
            completed_at = null,
            job_id = coalesce(p_job_id, job_id),
            billing_period_start = p_period_start,
            billing_period_end = p_period_end,
            source_page_units = 0
        where id = v_row.id
        returning * into v_row;
      return v_row;
    end if;
    if p_job_id is not null and v_row.job_id is null then
      update public.subscription_generation_usage
        set job_id = p_job_id
        where id = v_row.id
        returning * into v_row;
    end if;
    return v_row;
  end if;

  if p_job_id is not null then
    select u.* into v_row
    from public.subscription_generation_usage u
    where u.job_id = p_job_id
      and u.status in ('reserved', 'completed')
    limit 1;
    if found then
      return v_row;
    end if;
  end if;

  if v_reason = 'initial' and v_units > 0 and p_course_id is not null then
    select u.* into v_row
    from public.subscription_generation_usage u
    where u.course_id = p_course_id
      and u.generation_reason = 'initial'
      and u.course_generation_units > 0
      and u.status in ('reserved', 'completed')
    limit 1;
    if found then
      -- Initial credit already reserved/completed for this course.
      -- Caller should treat follow-up jobs as additional material.
      v_reason := 'additional_material';
      v_units := 0;
    end if;
  end if;

  if p_cap is not null then
    select s.course_generation_units into v_used
    from public.subscription_usage_used(p_user_id, p_period_start) s;
    if coalesce(v_used, 0) + v_units > p_cap then
      raise exception 'course_generation_cap_reached: plan allows % generation(s)', p_cap
        using errcode = 'P0001';
    end if;
  end if;

  begin
    insert into public.subscription_generation_usage (
      user_id,
      billing_period_start,
      billing_period_end,
      tier_snapshot,
      course_id,
      job_id,
      idempotency_key,
      generation_reason,
      course_generation_units,
      source_page_units,
      status
    ) values (
      p_user_id,
      p_period_start,
      p_period_end,
      coalesce(p_tier, 'free'),
      p_course_id,
      p_job_id,
      p_idempotency_key,
      v_reason,
      v_units,
      0,
      'reserved'
    )
    returning * into v_row;
  exception
    when unique_violation then
      select u.* into v_row
      from public.subscription_generation_usage u
      where u.user_id = p_user_id
        and u.idempotency_key = p_idempotency_key
      limit 1;
      if found then
        return v_row;
      end if;
      if v_reason = 'initial' and p_course_id is not null then
        -- Lost the initial race: insert additional (0 gen) instead.
        insert into public.subscription_generation_usage (
          user_id,
          billing_period_start,
          billing_period_end,
          tier_snapshot,
          course_id,
          job_id,
          idempotency_key,
          generation_reason,
          course_generation_units,
          source_page_units,
          status
        ) values (
          p_user_id,
          p_period_start,
          p_period_end,
          coalesce(p_tier, 'free'),
          p_course_id,
          p_job_id,
          p_idempotency_key,
          'additional_material',
          0,
          0,
          'reserved'
        )
        returning * into v_row;
        return v_row;
      end if;
      raise;
  end;

  return v_row;
end;
$$;

create or replace function public.reserve_source_pages(
  p_reservation_id uuid,
  p_user_id uuid,
  p_source_page_units integer,
  p_cap integer,
  p_period_start timestamptz
)
returns public.subscription_generation_usage
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.subscription_generation_usage;
  v_used int;
  v_pages int;
begin
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  v_pages := greatest(0, coalesce(p_source_page_units, 0));

  perform pg_advisory_xact_lock(
    hashtext(p_user_id::text),
    hashtext(coalesce(p_period_start::text, ''))
  );

  select u.* into v_row
  from public.subscription_generation_usage u
  where u.id = p_reservation_id
    and u.user_id = p_user_id
  for update;
  if not found then
    raise exception 'reservation_not_found' using errcode = 'P0002';
  end if;
  if v_row.status = 'released' then
    raise exception 'reservation_released' using errcode = 'P0002';
  end if;

  select s.source_page_units into v_used
  from public.subscription_usage_used(p_user_id, p_period_start) s;
  v_used := coalesce(v_used, 0) - coalesce(v_row.source_page_units, 0);

  if p_cap is not null and v_used + v_pages > p_cap then
    raise exception 'source_page_cap_reached: % of % pages used', v_used, p_cap
      using errcode = 'P0001';
  end if;

  update public.subscription_generation_usage
    set source_page_units = v_pages
    where id = v_row.id
    returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.finalize_generation_usage(
  p_reservation_id uuid
)
returns public.subscription_generation_usage
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.subscription_generation_usage;
begin
  select u.* into v_row
  from public.subscription_generation_usage u
  where u.id = p_reservation_id
  for update;
  if not found then
    raise exception 'reservation_not_found' using errcode = 'P0002';
  end if;
  if v_row.status = 'completed' then
    return v_row;
  end if;
  if v_row.status = 'released' then
    raise exception 'reservation_released' using errcode = 'P0002';
  end if;

  update public.subscription_generation_usage
    set status = 'completed',
        completed_at = now()
    where id = v_row.id
    returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.release_generation_usage(
  p_reservation_id uuid
)
returns public.subscription_generation_usage
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.subscription_generation_usage;
begin
  select u.* into v_row
  from public.subscription_generation_usage u
  where u.id = p_reservation_id
  for update;
  if not found then
    return null;
  end if;
  -- Completed usage is durable even if the course is later deleted.
  if v_row.status = 'completed' then
    return v_row;
  end if;
  if v_row.status = 'released' then
    return v_row;
  end if;

  update public.subscription_generation_usage
    set status = 'released',
        released_at = now()
    where id = v_row.id
    returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.subscription_usage_used(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.subscription_usage_used(uuid, timestamptz) to service_role;

revoke all on function public.reserve_course_generation(uuid, uuid, uuid, timestamptz, timestamptz, text, text, integer, text, integer) from public, anon, authenticated;
revoke all on function public.reserve_source_pages(uuid, uuid, integer, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.finalize_generation_usage(uuid) from public, anon, authenticated;
revoke all on function public.release_generation_usage(uuid) from public, anon, authenticated;
grant execute on function public.reserve_course_generation(uuid, uuid, uuid, timestamptz, timestamptz, text, text, integer, text, integer) to service_role;
grant execute on function public.reserve_source_pages(uuid, uuid, integer, integer, timestamptz) to service_role;
grant execute on function public.finalize_generation_usage(uuid) to service_role;
grant execute on function public.release_generation_usage(uuid) to service_role;
revoke all on function public.get_subscription_generation_usage(uuid, timestamptz) from public, anon;
grant execute on function public.get_subscription_generation_usage(uuid, timestamptz) to service_role, authenticated;

grant select on public.subscription_generation_usage to authenticated;
grant all on public.subscription_generation_usage to service_role;

-- ── Drop course-row COUNT(*) insert cap ──────────────────────────────────────
drop trigger if exists courses_enforce_creation_cap on public.courses;

create or replace function public.enforce_course_creation_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Empty course shells are not metered. AI generations are reserved in
  -- subscription_generation_usage before expensive ingest.
  return new;
end;
$$;

comment on function public.enforce_course_creation_cap() is
  'No-op. Course inserts are not billed; see subscription_generation_usage.';

-- ── Lecture recordings: count started sessions, including soft-deleted ───────
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
  if public.is_plan_cap_exempt(new.user_id) then
    return new;
  end if;

  v_tier := public.plan_tier_for_user(new.user_id);
  v_cap := case v_tier
    when 'basic' then 2
    when 'student' then 8
    when 'plus' then 15
    when 'advanced' then 25
    when 'premium' then 40
    else 0
  end;

  if v_cap is null then
    return new;
  end if;

  v_period_start := public.plan_period_start_for_user(new.user_id);

  select count(*)::int into v_used
  from public.live_lecture_sessions s
  where s.user_id = new.user_id
    and s.created_at >= v_period_start;

  if coalesce(v_used, 0) >= v_cap then
    raise exception 'lecture_recording_cap_reached: plan allows % recording(s) this period', v_cap
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

comment on function public.enforce_lecture_recording_cap() is
  'Blocks new live lecture sessions past plan caps per billing period. Soft-deleted sessions still count.';
