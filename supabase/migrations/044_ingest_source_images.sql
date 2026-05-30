-- Figures extracted from PDF/PPTX/DOCX during ingest (URLs in study-material-images).

alter table public.pdf_ingest_jobs
  add column if not exists ingest_source_images jsonb not null default '[]'::jsonb;

comment on column public.pdf_ingest_jobs.ingest_source_images is
  'Hosted URLs for figures extracted from the upload; embedded into lessons at finalize.';
