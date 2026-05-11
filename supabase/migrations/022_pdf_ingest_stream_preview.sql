-- Live “typewriter” preview while Claude streams outline / module JSON (polled by the course UI).

alter table public.pdf_ingest_jobs
  add column if not exists stream_preview text;

comment on column public.pdf_ingest_jobs.stream_preview is
  'Latest tail of the assistant text while a model call is streaming; cleared when the step completes.';
