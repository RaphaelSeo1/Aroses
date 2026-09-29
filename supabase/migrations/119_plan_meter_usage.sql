-- Per-student plan meters for the current billing period:
--   lecture_seconds  — recorded live lecture time (Deepgram), in seconds
--   extra_questions  — "generate more questions" / "focus questions" clicks
--
-- Caps live in src/lib/billing/plans.ts; the server code is
-- src/lib/billing/plan-meter-store.ts.
--
-- Same rules as chat_message_usage (117): one server-only row per user and
-- meter, written only via the service-role key through SECURITY DEFINER RPCs
-- that serialize writers with a row lock. RLS is on with NO policies. A newer
-- period_start resets the counter (no cron); an older one keeps counting the
-- stored period instead of granting a fresh allowance.
--
-- The app fails open (no cap) until this migration is applied. Lecture time
-- is still limited by the sum of session durations in the period.

create table if not exists public.plan_meter_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  meter text not null check (meter in ('lecture_seconds', 'extra_questions')),
  period_start timestamptz not null,
  used double precision not null default 0 check (used >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, meter)
);

alter table public.plan_meter_usage enable row level security;
-- No policies: only the service-role key (which bypasses RLS) touches this.

-- Add p_amount if it fits under p_cap (null = no cap). Returns whether it was
-- counted, usage after the call, and the period it was counted under.
create or replace function public.plan_meter_reserve(
  p_user_id uuid,
  p_meter text,
  p_period_start timestamptz,
  p_amount double precision,
  p_cap double precision
)
returns table (allowed boolean, used double precision, counted_period_start timestamptz)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_used double precision;
  v_start timestamptz;
  v_amount double precision := greatest(0, coalesce(p_amount, 0));
begin
  insert into public.plan_meter_usage (user_id, meter, period_start, used)
    values (p_user_id, p_meter, p_period_start, 0)
    on conflict (user_id, meter) do nothing;

  select pm.used, pm.period_start
    into v_used, v_start
    from public.plan_meter_usage pm
    where pm.user_id = p_user_id and pm.meter = p_meter
    for update;

  if v_start is null or v_start < p_period_start then
    v_used := 0;
    v_start := p_period_start;
    update public.plan_meter_usage pm
      set period_start = p_period_start,
          used = 0,
          updated_at = now()
      where pm.user_id = p_user_id and pm.meter = p_meter;
  end if;

  v_used := coalesce(v_used, 0);
  if p_cap is not null and v_used + v_amount > greatest(0, p_cap) then
    return query select false, v_used, v_start;
    return;
  end if;

  v_used := v_used + v_amount;
  update public.plan_meter_usage pm
    set used = v_used,
        updated_at = now()
    where pm.user_id = p_user_id and pm.meter = p_meter;

  return query select true, v_used, v_start;
end;
$$;

-- Give back p_amount counted under p_period_start (the AI call failed).
-- No-op if the period has since rolled over.
create or replace function public.plan_meter_refund(
  p_user_id uuid,
  p_meter text,
  p_period_start timestamptz,
  p_amount double precision
)
returns double precision
language plpgsql
security definer
set search_path = public
as $$
declare
  v_used double precision;
begin
  update public.plan_meter_usage pm
    set used = greatest(0, pm.used - greatest(0, coalesce(p_amount, 0))),
        updated_at = now()
    where pm.user_id = p_user_id
      and pm.meter = p_meter
      and pm.period_start = p_period_start
    returning pm.used into v_used;
  return coalesce(v_used, 0);
end;
$$;

-- Usage in the period starting at p_period_start (0 if the stored row is older).
create or replace function public.plan_meter_get(
  p_user_id uuid,
  p_meter text,
  p_period_start timestamptz
)
returns double precision
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select pm.used
      from public.plan_meter_usage pm
      where pm.user_id = p_user_id
        and pm.meter = p_meter
        and pm.period_start >= p_period_start
    ),
    0
  );
$$;

revoke all on function public.plan_meter_reserve(uuid, text, timestamptz, double precision, double precision)
  from public, anon, authenticated;
revoke all on function public.plan_meter_refund(uuid, text, timestamptz, double precision)
  from public, anon, authenticated;
revoke all on function public.plan_meter_get(uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.plan_meter_reserve(uuid, text, timestamptz, double precision, double precision)
  to service_role;
grant execute on function public.plan_meter_refund(uuid, text, timestamptz, double precision)
  to service_role;
grant execute on function public.plan_meter_get(uuid, text, timestamptz)
  to service_role;

comment on table public.plan_meter_usage is
  'Per-user plan meters (live lecture seconds, extra-question clicks) for the current billing period. Server-only (service-role); caps in src/lib/billing/plans.ts.';
