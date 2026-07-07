-- Observability: server-side error reporting + degraded-build tracking.
--
-- `error_events` captures errors that were previously console.warn-only in
-- critical paths (PDF ingest enrichment, finalize, voice metering) so silent
-- degradation becomes visible. Writes go through the service-role client only;
-- reads are restricted to app super admins.
--
-- `pdf_ingest_jobs.degraded_reasons` records which optional enrichment steps
-- failed open during a build (e.g. table vision), so a course that shipped
-- without tables/figures is identifiable after the fact.

create table if not exists public.error_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  scope text not null,
  message text not null,
  job_id uuid,
  user_id uuid,
  detail jsonb
);

create index if not exists error_events_created_at_idx
  on public.error_events (created_at desc);
create index if not exists error_events_scope_idx
  on public.error_events (scope);

alter table public.error_events enable row level security;

-- No insert/update/delete policies: only the service-role client writes.
drop policy if exists "error_events_super_admin_select" on public.error_events;
create policy "error_events_super_admin_select"
  on public.error_events for select
  using (public.is_app_super_admin());

alter table public.pdf_ingest_jobs
  add column if not exists degraded_reasons text[];

comment on column public.pdf_ingest_jobs.degraded_reasons is
  'Optional enrichment steps that failed open during this build (e.g. table_vision_failed). The course completed but may be missing tables/figures.';
