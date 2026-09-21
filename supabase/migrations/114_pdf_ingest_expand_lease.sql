-- Course-build concurrency lease.
--
-- `runPdfIngestExpandOne` had no mutual exclusion: the browser poll loop, the
-- per-minute cron reaper and the GET-route stall re-kick could all enter the
-- same job at once. Each invocation independently read the contiguous module
-- prefix, picked the SAME batch indices, and generated the same modules with
-- Sonnet. Every duplicate set was billed and all but one discarded — the main
-- driver of runaway course-build cost.
--
-- A short lease makes duplicate invocations cheap no-ops. It is deliberately
-- time-bounded rather than released-on-exit so a killed lambda (Vercel
-- maxDuration, OOM, 504) cannot wedge the job: the lease simply expires and the
-- reaper picks it up.

alter table public.pdf_ingest_jobs
  add column if not exists expand_lease_until timestamptz;

comment on column public.pdf_ingest_jobs.expand_lease_until is
  'Exclusive lease for module-batch expansion. A worker may only build modules for this job while it holds an unexpired lease. NULL or past = free.';

-- Reaper/claim lookups filter on status + lease.
create index if not exists pdf_ingest_jobs_expand_lease_idx
  on public.pdf_ingest_jobs (status, expand_lease_until);
