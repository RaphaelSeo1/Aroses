-- Bumps when a job is restarted so an older in-flight `runPdfIngestJob` cannot overwrite state.

alter table public.pdf_ingest_jobs
  add column if not exists ingest_epoch integer not null default 0;
