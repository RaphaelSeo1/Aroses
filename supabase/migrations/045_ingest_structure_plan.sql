-- Content-driven course structure planning (feature flag STRUCTURE_PLANNING).
-- The planner groups extracted chunks into modules/lessons regardless of file
-- boundaries; per-module source text is assembled from each lesson's chunks.

alter table public.pdf_ingest_jobs
  add column if not exists ingest_plan jsonb,
  add column if not exists ingest_module_sources jsonb;

comment on column public.pdf_ingest_jobs.ingest_plan is
  'Proposed course structure from planCourseStructureFromChunks: { modules:[{ title, summary, lessons:[{ title, summary, source_chunk_ids[] }] }] }. Survives restarts; can be shown to the user.';
comment on column public.pdf_ingest_jobs.ingest_module_sources is
  'Index-aligned per-module source text assembled from each module lessons source_chunk_ids; used during expand so a lesson can span files and a file can split across lessons.';
