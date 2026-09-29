-- Per-student monthly chat message meter.
--
-- Counts Rose text chat turns (study chat, review chat, Mentored Learning
-- turns, tutor sessions, calendar Ask Rose). Caps and the Sonnet → Haiku
-- switch point live in src/lib/billing/chat-limits.ts; enforcement is in
-- src/lib/billing/chat-usage.ts.
--
-- Mirrors voice_usage (054): one server-only row per user, written only via
-- the service-role key through SECURITY DEFINER RPCs that serialize writers
-- with a row lock. RLS is on with NO policies, so browsers can't read or
-- spoof usage.
--
-- A message is reserved (counted) BEFORE the model call and refunded if the
-- call fails. Passing a newer period_start resets the counter, so usage
-- zeroes at each billing period without a cron. An older period_start (e.g.
-- after a downgrade to the calendar-month free period) keeps counting the
-- stored period instead of granting a fresh allowance.
--
-- The app fails open (no cap) until this migration is applied.

create table if not exists public.chat_message_usage (
  user_id uuid primary key references auth.users(id) on delete cascade,
  period_start timestamptz not null,
  messages_used integer not null default 0 check (messages_used >= 0),
  updated_at timestamptz not null default now()
);

alter table public.chat_message_usage enable row level security;
-- No policies: only the service-role key (which bypasses RLS) touches this.

-- Count one message if the user is under p_cap. Returns whether it was
-- counted, the usage after counting, and the period it was counted under.
create or replace function public.chat_message_reserve(
  p_user_id uuid,
  p_period_start timestamptz,
  p_cap integer
)
returns table (allowed boolean, messages_count integer, counted_period_start timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_used integer;
  v_start timestamptz;
begin
  insert into public.chat_message_usage (user_id, period_start, messages_used)
    values (p_user_id, p_period_start, 0)
    on conflict (user_id) do nothing;

  select cu.messages_used, cu.period_start
    into v_used, v_start
    from public.chat_message_usage cu
    where cu.user_id = p_user_id
    for update;

  if v_start is null or v_start < p_period_start then
    v_used := 0;
    v_start := p_period_start;
    update public.chat_message_usage
      set period_start = p_period_start,
          messages_used = 0,
          updated_at = now()
      where user_id = p_user_id;
  end if;

  if p_cap is not null and coalesce(v_used, 0) >= greatest(0, p_cap) then
    return query select false, coalesce(v_used, 0), v_start;
    return;
  end if;

  v_used := coalesce(v_used, 0) + 1;
  update public.chat_message_usage
    set messages_used = v_used,
        updated_at = now()
    where user_id = p_user_id;

  return query select true, v_used, v_start;
end;
$$;

-- Give back one message counted under p_period_start (model call failed).
-- No-op if the period has since rolled over or nothing is counted.
create or replace function public.chat_message_refund(
  p_user_id uuid,
  p_period_start timestamptz
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_used integer;
begin
  update public.chat_message_usage
    set messages_used = messages_used - 1,
        updated_at = now()
    where user_id = p_user_id
      and period_start = p_period_start
      and messages_used > 0
    returning messages_used into v_used;
  return coalesce(v_used, 0);
end;
$$;

revoke all on function public.chat_message_reserve(uuid, timestamptz, integer)
  from public, anon, authenticated;
revoke all on function public.chat_message_refund(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.chat_message_reserve(uuid, timestamptz, integer)
  to service_role;
grant execute on function public.chat_message_refund(uuid, timestamptz)
  to service_role;

comment on table public.chat_message_usage is
  'Per-user Rose chat messages for the current billing period. Server-only (service-role); caps in src/lib/billing/chat-limits.ts.';
