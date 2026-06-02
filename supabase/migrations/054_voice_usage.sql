-- Per-user voice-tutoring usage meter.
--
-- Voice is the metered premium (see src/lib/billing/plans.ts). Every TTS
-- synthesis records its spoken seconds here; before granting voice we check the
-- running total against the tier's monthly cap. When the cap is hit, voice
-- stops and the client falls back to free text mode (never a hard block).
--
-- Mirrors the Claude rate limiter (046): a server-only table written exclusively
-- via the service-role key, with SECURITY DEFINER RPCs that serialize concurrent
-- writers via a row lock. RLS is enabled with NO policies, so anon/authenticated
-- clients have no direct access — usage can't be spoofed from the browser.
--
-- `period_start` anchors the current billing window. For paid users it's the
-- Stripe current_period_start; for free users it's the start of the calendar
-- month (UTC). The consume/get RPCs auto-reset the counter when the caller
-- passes a newer period_start than what's stored, so usage zeroes at each new
-- period without a separate cron.
--
-- `bonus_seconds` is the seam for à-la-carte voice top-ups: extra seconds added
-- to the current period's allowance. Not yet wired to a purchase flow.

create table if not exists public.voice_usage (
  user_id uuid primary key references auth.users(id) on delete cascade,
  period_start timestamptz not null,
  seconds_used double precision not null default 0,
  bonus_seconds double precision not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.voice_usage enable row level security;
-- No policies: only the service-role key (which bypasses RLS) touches this.

-- Atomically add `p_seconds` to the user's usage for the given period, resetting
-- first if the stored period is older than `p_period_start`. Returns the usage
-- AFTER the addition: seconds_used and bonus_seconds for the current period.
create or replace function public.voice_usage_consume(
  p_user_id uuid,
  p_seconds double precision,
  p_period_start timestamptz
)
returns table (seconds_used double precision, bonus_seconds double precision)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_used double precision;
  v_bonus double precision;
  v_stored_start timestamptz;
begin
  insert into public.voice_usage (user_id, period_start, seconds_used, bonus_seconds)
    values (p_user_id, p_period_start, 0, 0)
    on conflict (user_id) do nothing;

  select vu.seconds_used, vu.bonus_seconds, vu.period_start
    into v_used, v_bonus, v_stored_start
    from public.voice_usage vu
    where vu.user_id = p_user_id
    for update;

  -- New billing period → reset the counter (bonus top-ups are period-scoped).
  if v_stored_start is null or v_stored_start < p_period_start then
    v_used := 0;
    v_bonus := 0;
    update public.voice_usage
      set period_start = p_period_start,
          seconds_used = 0,
          bonus_seconds = 0,
          updated_at = now()
      where user_id = p_user_id;
  end if;

  v_used := greatest(0, v_used) + greatest(0, p_seconds);

  update public.voice_usage
    set seconds_used = v_used,
        updated_at = now()
    where user_id = p_user_id;

  return query select v_used, coalesce(v_bonus, 0);
end;
$$;

-- Read current-period usage WITHOUT mutating. A missing row or a stored period
-- older than p_period_start reads as 0 used (the next consume will reset).
create or replace function public.voice_usage_get(
  p_user_id uuid,
  p_period_start timestamptz
)
returns table (seconds_used double precision, bonus_seconds double precision)
language sql
security definer
set search_path = public
as $$
  select
    case when vu.period_start >= p_period_start then vu.seconds_used else 0 end,
    case when vu.period_start >= p_period_start then vu.bonus_seconds else 0 end
  from public.voice_usage vu
  where vu.user_id = p_user_id
  union all
  select 0, 0
  where not exists (
    select 1 from public.voice_usage vu2 where vu2.user_id = p_user_id
  )
  limit 1;
$$;

-- Both RPCs are only ever invoked with the service-role key from server code.
revoke all on function public.voice_usage_consume(uuid, double precision, timestamptz)
  from public, anon, authenticated;
revoke all on function public.voice_usage_get(uuid, timestamptz)
  from public, anon, authenticated;

comment on table public.voice_usage is
  'Per-user voice-tutoring seconds for the current billing period. Server-only (service-role); enforced against tier caps in src/lib/billing/voice-usage.ts.';
