-- Course-build concurrency lease + hard per-job spend ceiling.
--
-- `runPdfIngestExpandOne` had no mutual exclusion: the browser poll loop, the
-- per-minute cron reaper and the GET-route stall re-kick could all enter the
-- same job at once. Each read the same contiguous module prefix, picked the
-- SAME batch indices, and generated the same modules. Measured on one job:
-- 830 Sonnet calls for a 7-module course, and 1,062 Haiku calls on another.
-- Every duplicate set was billed; all but one was discarded.
--
-- The lease is time-bounded rather than released-on-exit, so a killed lambda
-- (maxDuration, OOM, 504) cannot wedge a job: the lease simply expires and the
-- reaper resumes.

alter table public.pdf_ingest_jobs
  add column if not exists expand_lease_until timestamptz;

comment on column public.pdf_ingest_jobs.expand_lease_until is
  'Exclusive lease for module-batch expansion. A worker may only build modules while holding an unexpired lease. NULL or past = free.';

create index if not exists pdf_ingest_jobs_expand_lease_idx
  on public.pdf_ingest_jobs (status, expand_lease_until);

-- Atomic claim. Done as a function rather than a PostgREST filter so the
-- compare-and-set is a single statement with no client-side filter-string
-- parsing that could silently fail open.
create or replace function public.claim_pdf_ingest_expand_lease(
  p_job_id uuid,
  p_lease_seconds integer default 240
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed boolean := false;
begin
  update public.pdf_ingest_jobs
     set expand_lease_until = now() + make_interval(secs => p_lease_seconds)
   where id = p_job_id
     and (expand_lease_until is null or expand_lease_until < now());

  get diagnostics v_claimed = row_count;
  return v_claimed;
end;
$$;

create or replace function public.release_pdf_ingest_expand_lease(p_job_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.pdf_ingest_jobs
     set expand_lease_until = null
   where id = p_job_id;
$$;

create or replace function public.renew_pdf_ingest_expand_lease(
  p_job_id uuid,
  p_lease_seconds integer default 240
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.pdf_ingest_jobs
     set expand_lease_until = now() + make_interval(secs => p_lease_seconds)
   where id = p_job_id;
$$;

revoke all on function public.claim_pdf_ingest_expand_lease(uuid, integer) from public, anon, authenticated;
revoke all on function public.release_pdf_ingest_expand_lease(uuid) from public, anon, authenticated;
revoke all on function public.renew_pdf_ingest_expand_lease(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_pdf_ingest_expand_lease(uuid, integer) to service_role;
grant execute on function public.release_pdf_ingest_expand_lease(uuid) to service_role;
grant execute on function public.renew_pdf_ingest_expand_lease(uuid, integer) to service_role;

-- Hard ceiling: how many Claude calls a single ingest job may ever make.
-- Backstop for the lease and the retry deadline — if either is defeated by a
-- bug, this still stops a runaway instead of draining the account.
create index if not exists ai_usage_events_job_idx
  on public.ai_usage_events (job_id);
