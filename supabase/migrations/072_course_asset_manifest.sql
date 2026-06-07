-- Global PDF asset manifest (tables + figures) with caption embeddings for
-- semantic placement across lessons, self-study, and mentored whiteboard.

alter table public.pdf_ingest_jobs
  add column if not exists ingest_asset_manifest jsonb;

comment on column public.pdf_ingest_jobs.ingest_asset_manifest is
  'CourseAssetManifest: asset_id, type, url, caption, embedding — built after vision enrich.';

alter table public.study_materials
  add column if not exists asset_manifest jsonb;

comment on column public.study_materials.asset_manifest is
  'Persisted CourseAssetManifest for lesson placement and mentored show_asset.';
