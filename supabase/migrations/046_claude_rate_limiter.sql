-- Global, DB-backed Claude rate limiter.
--
-- Why: course building runs many Anthropic calls in parallel across multiple
-- serverless invocations. In-memory caps can't coordinate across lambdas, so we
-- previously throttled with a crude per-user "max 3 concurrent jobs" heuristic
-- tuned for Anthropic Tier 1. On Tier 2+ that cap leaves most jobs queued and
-- looking "stuck". This table is a shared per-minute token/request budget that
-- every Claude call reserves against, so we can run many jobs in parallel up to
-- the org's real rate limit instead of a fixed job count.

create table if not exists public.claude_rate_usage (
  window_start timestamptz primary key,
  requests integer not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  updated_at timestamptz not null default now()
);

-- Server-only table: written exclusively via the service-role key (which
-- bypasses RLS). Enable RLS with no policies so anon/authenticated clients have
-- no access at all.
alter table public.claude_rate_usage enable row level security;

-- Atomically try to reserve budget for one Claude call in the current minute.
-- Returns granted=true if the call fits within the per-minute caps (and records
-- the reservation), otherwise granted=false with the ms until the next window.
-- A row-level lock on the window serializes concurrent acquirers so the caps
-- hold even under heavy parallelism.
create or replace function public.claude_rate_try_acquire(
  p_est_input bigint,
  p_est_output bigint,
  p_max_requests integer,
  p_max_input bigint,
  p_max_output bigint
)
returns table (granted boolean, retry_after_ms integer)
language plpgsql
as $$
declare
  v_window timestamptz := date_trunc('minute', now());
  v_requests integer;
  v_input bigint;
  v_output bigint;
begin
  -- Opportunistic cleanup of stale windows (cheap, keeps the table tiny).
  delete from public.claude_rate_usage where window_start < now() - interval '15 minutes';

  insert into public.claude_rate_usage (window_start)
    values (v_window)
    on conflict (window_start) do nothing;

  select requests, input_tokens, output_tokens
    into v_requests, v_input, v_output
    from public.claude_rate_usage
    where window_start = v_window
    for update;

  if (v_requests + 1) <= p_max_requests
     and (v_input + p_est_input) <= p_max_input
     and (v_output + p_est_output) <= p_max_output then
    update public.claude_rate_usage
      set requests = requests + 1,
          input_tokens = input_tokens + p_est_input,
          output_tokens = output_tokens + p_est_output,
          updated_at = now()
      where window_start = v_window;
    return query select true, 0;
  else
    return query select
      false,
      greatest(
        250,
        (extract(epoch from (v_window + interval '1 minute' - now())) * 1000)::integer
      );
  end if;
end;
$$;

-- The limiter is only ever called with the service-role key from server code.
revoke all on function public.claude_rate_try_acquire(bigint, bigint, integer, bigint, bigint) from public, anon, authenticated;
