-- Vision-extracted markdown tables keyed by source file + page (survives module
-- source truncation and guarantees tables can be injected after LLM generation).

alter table public.pdf_ingest_jobs
  add column if not exists ingest_page_tables jsonb;

comment on column public.pdf_ingest_jobs.ingest_page_tables is
  'Map of pageTableKey → markdown table text from PDF page vision (service role only).';
