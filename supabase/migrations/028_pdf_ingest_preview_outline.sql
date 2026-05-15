-- Provisional outline from fast PDF slice; cleared when final `ingest_outline` is saved.

alter table public.pdf_ingest_jobs
  add column if not exists ingest_preview_outline jsonb;

comment on column public.pdf_ingest_jobs.ingest_preview_outline is
  'Fast-path outline from a head/tail PDF excerpt; replaced when final ingest_outline is persisted.';
