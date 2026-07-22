-- Always retain course ingest uploads by default (admin can open source PDFs).

alter table public.pdf_ingest_jobs
  alter column retain_storage set default true;

comment on column public.pdf_ingest_jobs.retain_storage is
  'When true, original uploads stay in study-pdf-ingest after build. Default true so admins can review sources.';
