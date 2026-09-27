-- Course builder: one server-side job per build, made of small saved steps.
--
-- Guarantees enforced here rather than in app code:
--   * One worker per build. A worker may only claim steps while it holds the
--     build lease; the lease is time-bounded so a killed lambda cannot wedge
--     a build.
--   * A step is claimed atomically (FOR UPDATE SKIP LOCKED) and its result can
--     only be written by the worker that claimed it. Finished steps are never
--     redone.
--   * Retries are a fixed count stored on the step. Rate limits reschedule the
--     step instead of waiting inside a request, and do not use up an attempt.
--   * Every AI call reserves its worst-case cost against the build cap and the
--     user's rolling 24-hour cap before it is sent. The check and the insert
--     run in one transaction under a per-user lock; if the check cannot run,
--     the app refuses the call.
--
-- All functions are service-role only. Clients can read their own builds.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.course_builds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  exam_group_id uuid references public.exam_groups (id) on delete set null,
  material_id uuid references public.study_materials (id) on delete set null,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'complete', 'failed', 'canceled')),
  output_language text,
  study_goal text,
  source_pages integer not null default 0 check (source_pages >= 0),
  spend_cap_usd numeric(12, 6) not null check (spend_cap_usd > 0),
  daily_cap_usd numeric(12, 6) not null check (daily_cap_usd > 0),
  usage_reservation_id uuid,
  plan jsonb,
  course_info jsonb,
  lease_owner text,
  lease_until timestamptz,
  cancel_requested_at timestamptz,
  error_code text,
  error_message text,
  first_module_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists course_builds_user_idx
  on public.course_builds (user_id, created_at desc);
create index if not exists course_builds_course_idx
  on public.course_builds (course_id);
create index if not exists course_builds_active_idx
  on public.course_builds (status, lease_until)
  where status in ('queued', 'running');

comment on column public.course_builds.spend_cap_usd is
  'Hard ceiling on AI spend for this build (reserved + settled). Set at creation.';
comment on column public.course_builds.daily_cap_usd is
  'User rolling 24-hour AI spend ceiling, snapshotted from the user''s plan at creation.';

create table if not exists public.course_build_sources (
  id uuid primary key default gen_random_uuid(),
  build_id uuid not null references public.course_builds (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  position integer not null check (position >= 0),
  kind text not null
    check (kind in (
      'pdf', 'pptx', 'docx', 'image', 'audio', 'video', 'transcript',
      'text', 'url', 'note', 'live_session', 'tutor_session'
    )),
  label text not null,
  storage_path text,
  ref_id uuid,
  source_url text,
  page_count integer check (page_count is null or page_count >= 0),
  -- Cleaned text per page / slide: [{ "n": 1, "text": "..." }]
  pages jsonb,
  created_at timestamptz not null default now(),
  unique (build_id, position)
);

create table if not exists public.course_build_steps (
  id uuid primary key default gen_random_uuid(),
  build_id uuid not null references public.course_builds (id) on delete cascade,
  kind text not null
    check (kind in ('extract', 'plan', 'module', 'figures', 'finalize')),
  ordinal integer not null default 0,
  -- A step runs only after every step with a lower wave in the build is done.
  wave integer not null check (wave >= 0),
  status text not null default 'pending'
    check (status in ('pending', 'running', 'done', 'failed', 'canceled')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  rate_limited_count integer not null default 0,
  run_after timestamptz not null default now(),
  claimed_by text,
  lease_until timestamptz,
  input jsonb not null default '{}'::jsonb,
  output jsonb,
  last_error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (build_id, kind, ordinal)
);

create index if not exists course_build_steps_ready_idx
  on public.course_build_steps (build_id, status, wave, ordinal);

create table if not exists public.course_build_ai_ledger (
  id uuid primary key default gen_random_uuid(),
  build_id uuid references public.course_builds (id) on delete set null,
  step_id uuid references public.course_build_steps (id) on delete set null,
  user_id uuid not null references auth.users (id) on delete cascade,
  purpose text not null,
  model text not null,
  status text not null
    check (status in ('reserved', 'settled', 'failed', 'refused')),
  refusal_reason text,
  max_output_tokens integer not null default 0,
  est_cost_usd numeric(14, 8) not null default 0 check (est_cost_usd >= 0),
  input_tokens integer,
  output_tokens integer,
  cache_write_tokens integer,
  cache_read_tokens integer,
  cost_usd numeric(14, 8) check (cost_usd is null or cost_usd >= 0),
  created_at timestamptz not null default now(),
  settled_at timestamptz
);

create index if not exists course_build_ai_ledger_user_idx
  on public.course_build_ai_ledger (user_id, created_at desc);
create index if not exists course_build_ai_ledger_build_idx
  on public.course_build_ai_ledger (build_id);

comment on table public.course_build_ai_ledger is
  'One row per course-builder AI call. Reserved rows count at their worst-case estimate until settled.';

alter table public.study_materials
  add column if not exists build_id uuid references public.course_builds (id) on delete set null;
create index if not exists study_materials_build_idx
  on public.study_materials (build_id) where build_id is not null;

alter table public.courses
  add column if not exists course_info jsonb;
comment on column public.courses.course_info is
  'Syllabus / logistics / grading / deadlines pulled out of sources. Never turned into lessons.';

-- ---------------------------------------------------------------------------
-- RLS: owners read their builds; only the service role writes.
-- ---------------------------------------------------------------------------

alter table public.course_builds enable row level security;
alter table public.course_build_sources enable row level security;
alter table public.course_build_steps enable row level security;
alter table public.course_build_ai_ledger enable row level security;

drop policy if exists "course_builds_owner_select" on public.course_builds;
create policy "course_builds_owner_select"
  on public.course_builds for select
  using (auth.uid() = user_id);

drop policy if exists "course_build_sources_owner_select" on public.course_build_sources;
create policy "course_build_sources_owner_select"
  on public.course_build_sources for select
  using (auth.uid() = user_id);

drop policy if exists "course_build_steps_owner_select" on public.course_build_steps;
create policy "course_build_steps_owner_select"
  on public.course_build_steps for select
  using (
    exists (
      select 1 from public.course_builds b
      where b.id = course_build_steps.build_id and b.user_id = auth.uid()
    )
  );

drop policy if exists "course_build_ai_ledger_super_admin_select" on public.course_build_ai_ledger;
create policy "course_build_ai_ledger_super_admin_select"
  on public.course_build_ai_ledger for select
  using (public.is_app_super_admin());

-- ---------------------------------------------------------------------------
-- Build lease
-- ---------------------------------------------------------------------------

create or replace function public.course_build_claim_lease(
  p_build_id uuid,
  p_owner text,
  p_lease_seconds integer
)
returns table (ok boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.course_builds
     set lease_owner = p_owner,
         lease_until = now() + make_interval(secs => p_lease_seconds),
         status = case when status = 'queued' then 'running' else status end,
         updated_at = now()
   where id = p_build_id
     and status in ('queued', 'running')
     and (lease_until is null or lease_until < now() or lease_owner = p_owner);
  get diagnostics v_count = row_count;
  return query select v_count > 0;
end;
$$;

create or replace function public.course_build_renew_lease(
  p_build_id uuid,
  p_owner text,
  p_lease_seconds integer
)
returns table (ok boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.course_builds
     set lease_until = now() + make_interval(secs => p_lease_seconds),
         updated_at = now()
   where id = p_build_id
     and status = 'running'
     and lease_owner = p_owner;
  get diagnostics v_count = row_count;
  return query select v_count > 0;
end;
$$;

create or replace function public.course_build_release_lease(
  p_build_id uuid,
  p_owner text
)
returns table (ok boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.course_builds
     set lease_owner = null,
         lease_until = null,
         updated_at = now()
   where id = p_build_id
     and lease_owner = p_owner;
  get diagnostics v_count = row_count;
  return query select v_count > 0;
end;
$$;

-- ---------------------------------------------------------------------------
-- Steps
-- ---------------------------------------------------------------------------

-- Claims the next runnable step. Returns no row if the caller does not hold
-- the build lease, the build is canceled, or nothing is ready.
create or replace function public.course_build_claim_step(
  p_build_id uuid,
  p_owner text,
  p_step_lease_seconds integer
)
returns setof public.course_build_steps
language plpgsql
security definer
set search_path = public
as $$
declare
  v_step public.course_build_steps;
begin
  perform 1
     from public.course_builds
    where id = p_build_id
      and status = 'running'
      and cancel_requested_at is null
      and lease_owner = p_owner
      and lease_until > now();
  if not found then
    return;
  end if;

  -- A step whose worker died after its last allowed attempt is failed.
  update public.course_build_steps
     set status = 'failed',
         last_error = coalesce(last_error, 'Step timed out'),
         claimed_by = null,
         lease_until = null,
         finished_at = now(),
         updated_at = now()
   where build_id = p_build_id
     and status = 'running'
     and lease_until < now()
     and attempts >= max_attempts;

  select s.* into v_step
    from public.course_build_steps s
   where s.build_id = p_build_id
     and s.attempts < s.max_attempts
     and (
       (s.status = 'pending' and s.run_after <= now())
       or (s.status = 'running' and s.lease_until < now())
     )
     and not exists (
       select 1 from public.course_build_steps d
        where d.build_id = s.build_id
          and d.wave < s.wave
          and d.status <> 'done'
     )
   order by s.wave, s.ordinal
   limit 1
   for update skip locked;

  if not found then
    return;
  end if;

  update public.course_build_steps
     set status = 'running',
         attempts = attempts + 1,
         claimed_by = p_owner,
         lease_until = now() + make_interval(secs => p_step_lease_seconds),
         started_at = coalesce(started_at, now()),
         updated_at = now()
   where id = v_step.id
  returning * into v_step;

  return next v_step;
end;
$$;

create or replace function public.course_build_renew_step(
  p_step_id uuid,
  p_owner text,
  p_step_lease_seconds integer
)
returns table (ok boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.course_build_steps
     set lease_until = now() + make_interval(secs => p_step_lease_seconds),
         updated_at = now()
   where id = p_step_id
     and status = 'running'
     and claimed_by = p_owner;
  get diagnostics v_count = row_count;
  return query select v_count > 0;
end;
$$;

-- Saves a step's result and, in the same transaction, adds any follow-up
-- steps it produced (e.g. the plan step adds one step per module).
-- p_new_steps: [{ "kind", "ordinal", "wave", "input", "max_attempts" }]
create or replace function public.course_build_complete_step(
  p_step_id uuid,
  p_owner text,
  p_output jsonb,
  p_new_steps jsonb default '[]'::jsonb
)
returns table (ok boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_build_id uuid;
begin
  update public.course_build_steps
     set status = 'done',
         output = p_output,
         last_error = null,
         claimed_by = null,
         lease_until = null,
         finished_at = now(),
         updated_at = now()
   where id = p_step_id
     and status = 'running'
     and claimed_by = p_owner
  returning build_id into v_build_id;

  if v_build_id is null then
    return query select false;
    return;
  end if;

  insert into public.course_build_steps (build_id, kind, ordinal, wave, input, max_attempts)
  select v_build_id,
         x.kind,
         coalesce(x.ordinal, 0),
         x.wave,
         coalesce(x.input, '{}'::jsonb),
         coalesce(x.max_attempts, 3)
    from jsonb_to_recordset(coalesce(p_new_steps, '[]'::jsonb))
      as x (kind text, ordinal integer, wave integer, input jsonb, max_attempts integer)
  on conflict (build_id, kind, ordinal) do nothing;

  return query select true;
end;
$$;

-- Returns 'retry' (back to pending after the backoff), 'failed' (out of
-- attempts or not retryable) or 'stale' (caller no longer owns the step).
create or replace function public.course_build_fail_step(
  p_step_id uuid,
  p_owner text,
  p_error text,
  p_retryable boolean,
  p_backoff_seconds integer
)
returns table (outcome text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_step public.course_build_steps;
begin
  select * into v_step
    from public.course_build_steps
   where id = p_step_id
   for update;

  if not found or v_step.status <> 'running' or v_step.claimed_by is distinct from p_owner then
    return query select 'stale'::text;
    return;
  end if;

  if p_retryable and v_step.attempts < v_step.max_attempts then
    update public.course_build_steps
       set status = 'pending',
           run_after = now() + make_interval(secs => greatest(p_backoff_seconds, 0)),
           last_error = left(p_error, 2000),
           claimed_by = null,
           lease_until = null,
           updated_at = now()
     where id = p_step_id;
    return query select 'retry'::text;
  else
    update public.course_build_steps
       set status = 'failed',
           last_error = left(p_error, 2000),
           claimed_by = null,
           lease_until = null,
           finished_at = now(),
           updated_at = now()
     where id = p_step_id;
    return query select 'failed'::text;
  end if;
end;
$$;

-- Rate limited: give the attempt back and try again after the delay. After
-- p_max_rate_limited reschedules the step fails instead of looping forever.
create or replace function public.course_build_reschedule_step(
  p_step_id uuid,
  p_owner text,
  p_delay_seconds integer,
  p_reason text,
  p_max_rate_limited integer default 20
)
returns table (outcome text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_step public.course_build_steps;
begin
  select * into v_step
    from public.course_build_steps
   where id = p_step_id
   for update;

  if not found or v_step.status <> 'running' or v_step.claimed_by is distinct from p_owner then
    return query select 'stale'::text;
    return;
  end if;

  if v_step.rate_limited_count + 1 >= p_max_rate_limited then
    update public.course_build_steps
       set status = 'failed',
           rate_limited_count = rate_limited_count + 1,
           last_error = left(p_reason, 2000),
           claimed_by = null,
           lease_until = null,
           finished_at = now(),
           updated_at = now()
     where id = p_step_id;
    return query select 'failed'::text;
    return;
  end if;

  update public.course_build_steps
     set status = 'pending',
         attempts = greatest(attempts - 1, 0),
         rate_limited_count = rate_limited_count + 1,
         run_after = now() + make_interval(secs => greatest(p_delay_seconds, 1)),
         last_error = left(p_reason, 2000),
         claimed_by = null,
         lease_until = null,
         updated_at = now()
   where id = p_step_id;
  return query select 'rescheduled'::text;
end;
$$;

-- Snapshot the worker uses to decide whether to keep going.
create or replace function public.course_build_progress(p_build_id uuid)
returns table (
  build_status text,
  cancel_requested boolean,
  total integer,
  done integer,
  failed integer,
  ready integer,
  running_live integer,
  waiting integer,
  next_run_after timestamptz
)
language sql
security definer
set search_path = public
as $$
  with s as (
    select st.*,
           min(case when st.status <> 'done' then st.wave end) over () as gate_wave
      from public.course_build_steps st
     where st.build_id = p_build_id
  )
  select b.status,
         b.cancel_requested_at is not null,
         count(s.id)::integer,
         count(s.id) filter (where s.status = 'done')::integer,
         count(s.id) filter (where s.status = 'failed')::integer,
         count(s.id) filter (
           where s.wave <= s.gate_wave
             and s.attempts < s.max_attempts
             and ((s.status = 'pending' and s.run_after <= now())
                  or (s.status = 'running' and s.lease_until < now()))
         )::integer,
         count(s.id) filter (where s.status = 'running' and s.lease_until >= now())::integer,
         count(s.id) filter (where s.status = 'pending' and s.run_after > now())::integer,
         min(s.run_after) filter (where s.status = 'pending' and s.wave <= s.gate_wave)
    from public.course_builds b
    left join s on true
   where b.id = p_build_id
   group by b.id;
$$;

-- Moves a build to a terminal state and cancels its unfinished steps. The
-- caller must hold the lease, or the lease must be free/expired (cron sweep).
create or replace function public.course_build_finish(
  p_build_id uuid,
  p_owner text,
  p_status text,
  p_error_code text default null,
  p_error_message text default null
)
returns table (ok boolean, usage_reservation_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reservation uuid;
begin
  if p_status not in ('complete', 'failed', 'canceled') then
    raise exception 'course_build_invalid_terminal_status';
  end if;

  update public.course_builds
     set status = p_status,
         error_code = p_error_code,
         error_message = left(p_error_message, 2000),
         completed_at = now(),
         lease_owner = null,
         lease_until = null,
         updated_at = now()
   where id = p_build_id
     and status in ('queued', 'running')
     and (lease_owner = p_owner or lease_until is null or lease_until < now())
  returning course_builds.usage_reservation_id into v_reservation;

  if not found then
    return query select false, null::uuid;
    return;
  end if;

  update public.course_build_steps
     set status = 'canceled',
         claimed_by = null,
         lease_until = null,
         finished_at = now(),
         updated_at = now()
   where build_id = p_build_id
     and status in ('pending', 'running');

  return query select true, v_reservation;
end;
$$;

-- Builds that need a worker: not finished, lease free, and either something
-- is ready to run or a cancel is waiting to be applied.
create or replace function public.course_builds_needing_work(p_limit integer default 20)
returns table (build_id uuid)
language sql
security definer
set search_path = public
as $$
  select b.id
    from public.course_builds b
   where b.status in ('queued', 'running')
     and (b.lease_until is null or b.lease_until < now())
     and (
       b.cancel_requested_at is not null
       or exists (
         select 1 from public.course_build_steps s
          where s.build_id = b.id
            and ((s.status = 'pending' and s.run_after <= now())
                 or (s.status = 'running' and s.lease_until < now()))
       )
       or not exists (
         select 1 from public.course_build_steps s
          where s.build_id = b.id and s.status in ('pending', 'running')
       )
     )
   order by b.created_at
   limit greatest(p_limit, 1);
$$;

-- ---------------------------------------------------------------------------
-- AI spend ledger
-- ---------------------------------------------------------------------------

-- Reserves p_est_cost_usd for one call. Refuses (and records the refusal) if
-- the build's committed spend or the user's rolling 24-hour spend would pass
-- its cap. Reserved rows count at their estimate until settled.
create or replace function public.course_build_reserve_spend(
  p_build_id uuid,
  p_step_id uuid,
  p_user_id uuid,
  p_purpose text,
  p_model text,
  p_max_output_tokens integer,
  p_est_cost_usd numeric
)
returns table (
  ledger_id uuid,
  ok boolean,
  reason text,
  build_committed_usd numeric,
  build_cap_usd numeric,
  daily_committed_usd numeric,
  daily_cap_usd numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_build public.course_builds;
  v_build_committed numeric;
  v_daily_committed numeric;
  v_reason text := null;
  v_id uuid;
begin
  if p_est_cost_usd is null or p_est_cost_usd < 0 then
    raise exception 'course_build_invalid_estimate';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('course_build_spend:' || p_user_id::text, 0));

  select * into v_build
    from public.course_builds
   where id = p_build_id
   for update;
  if not found then
    raise exception 'course_build_not_found';
  end if;
  if v_build.user_id <> p_user_id then
    raise exception 'course_build_user_mismatch';
  end if;

  select coalesce(sum(
           case when l.status = 'reserved' then l.est_cost_usd
                else coalesce(l.cost_usd, 0) end
         ), 0)
    into v_build_committed
    from public.course_build_ai_ledger l
   where l.build_id = p_build_id;

  select coalesce(sum(
           case when l.status = 'reserved' then l.est_cost_usd
                else coalesce(l.cost_usd, 0) end
         ), 0)
    into v_daily_committed
    from public.course_build_ai_ledger l
   where l.user_id = p_user_id
     and l.created_at > now() - interval '24 hours';

  if v_build.status not in ('queued', 'running') or v_build.cancel_requested_at is not null then
    v_reason := 'build_not_running';
  elsif v_build_committed + p_est_cost_usd > v_build.spend_cap_usd then
    v_reason := 'build_cap';
  elsif v_daily_committed + p_est_cost_usd > v_build.daily_cap_usd then
    v_reason := 'daily_cap';
  end if;

  insert into public.course_build_ai_ledger (
    build_id, step_id, user_id, purpose, model, status, refusal_reason,
    max_output_tokens, est_cost_usd
  ) values (
    p_build_id, p_step_id, p_user_id, p_purpose, p_model,
    case when v_reason is null then 'reserved' else 'refused' end,
    v_reason, greatest(coalesce(p_max_output_tokens, 0), 0), p_est_cost_usd
  )
  returning id into v_id;

  return query select v_id,
                      v_reason is null,
                      v_reason,
                      v_build_committed,
                      v_build.spend_cap_usd,
                      v_daily_committed,
                      v_build.daily_cap_usd;
end;
$$;

-- p_status: 'settled' (call returned; actual cost) or 'failed' (the API
-- rejected the call; cost is whatever it billed, normally 0).
create or replace function public.course_build_settle_spend(
  p_ledger_id uuid,
  p_status text,
  p_input_tokens integer,
  p_output_tokens integer,
  p_cache_write_tokens integer,
  p_cache_read_tokens integer,
  p_cost_usd numeric
)
returns table (ok boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if p_status not in ('settled', 'failed') then
    raise exception 'course_build_invalid_settle_status';
  end if;
  if p_cost_usd is null or p_cost_usd < 0 then
    raise exception 'course_build_invalid_cost';
  end if;

  update public.course_build_ai_ledger
     set status = p_status,
         input_tokens = p_input_tokens,
         output_tokens = p_output_tokens,
         cache_write_tokens = p_cache_write_tokens,
         cache_read_tokens = p_cache_read_tokens,
         cost_usd = p_cost_usd,
         settled_at = now()
   where id = p_ledger_id
     and status = 'reserved';
  get diagnostics v_count = row_count;
  return query select v_count > 0;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function public.course_build_claim_lease(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.course_build_renew_lease(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.course_build_release_lease(uuid, text) from public, anon, authenticated;
revoke all on function public.course_build_claim_step(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.course_build_renew_step(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.course_build_complete_step(uuid, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.course_build_fail_step(uuid, text, text, boolean, integer) from public, anon, authenticated;
revoke all on function public.course_build_reschedule_step(uuid, text, integer, text, integer) from public, anon, authenticated;
revoke all on function public.course_build_progress(uuid) from public, anon, authenticated;
revoke all on function public.course_build_finish(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.course_builds_needing_work(integer) from public, anon, authenticated;
revoke all on function public.course_build_reserve_spend(uuid, uuid, uuid, text, text, integer, numeric) from public, anon, authenticated;
revoke all on function public.course_build_settle_spend(uuid, text, integer, integer, integer, integer, numeric) from public, anon, authenticated;

grant execute on function public.course_build_claim_lease(uuid, text, integer) to service_role;
grant execute on function public.course_build_renew_lease(uuid, text, integer) to service_role;
grant execute on function public.course_build_release_lease(uuid, text) to service_role;
grant execute on function public.course_build_claim_step(uuid, text, integer) to service_role;
grant execute on function public.course_build_renew_step(uuid, text, integer) to service_role;
grant execute on function public.course_build_complete_step(uuid, text, jsonb, jsonb) to service_role;
grant execute on function public.course_build_fail_step(uuid, text, text, boolean, integer) to service_role;
grant execute on function public.course_build_reschedule_step(uuid, text, integer, text, integer) to service_role;
grant execute on function public.course_build_progress(uuid) to service_role;
grant execute on function public.course_build_finish(uuid, text, text, text, text) to service_role;
grant execute on function public.course_builds_needing_work(integer) to service_role;
grant execute on function public.course_build_reserve_spend(uuid, uuid, uuid, text, text, integer, numeric) to service_role;
grant execute on function public.course_build_settle_spend(uuid, text, integer, integer, integer, integer, numeric) to service_role;
