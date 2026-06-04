-- Per-lesson source attribution: persist chunk catalog on ingest jobs and
-- optional source index on finished study materials.

alter table public.pdf_ingest_jobs
  add column if not exists ingest_chunks jsonb;

comment on column public.pdf_ingest_jobs.ingest_chunks is
  'Chunk catalog for attribution: [{ id, sourceFileName, position }] — no full text.';

alter table public.study_materials
  add column if not exists source_index jsonb;

comment on column public.study_materials.source_index is
  'Ingest chunk catalog + optional structure plan for source excerpts / citations.';
