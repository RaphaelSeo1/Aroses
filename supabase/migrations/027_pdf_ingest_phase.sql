-- Server-driven phase for PDF ingest UI (extract vs outline vs modules), not guessed from elapsed time.

alter table public.pdf_ingest_jobs
  add column if not exists ingest_phase text;

comment on column public.pdf_ingest_jobs.ingest_phase is
  'Worker hint: reading_pdf | planning_outline | writing_modules. Null when idle or unknown.';
