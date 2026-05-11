-- Chunked PDF → course: outline + per-module expansions (each request gets its own serverless budget).

alter table public.pdf_ingest_jobs
  add column if not exists ingest_source_text text,
  add column if not exists ingest_outline jsonb,
  add column if not exists ingest_modules jsonb not null default '[]'::jsonb;

comment on column public.pdf_ingest_jobs.ingest_source_text is 'Truncated extracted PDF text used for AI (service role only; not exposed to client).';
comment on column public.pdf_ingest_jobs.ingest_outline is 'Course outline JSON after phase 1 (title, description, module stubs).';
comment on column public.pdf_ingest_jobs.ingest_modules is 'Built CourseModule[] appended one per /api/process-pdf/expand call.';
