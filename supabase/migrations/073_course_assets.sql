-- Phase 1: first-class PDF visual assets (raster, vector, vision fallback, tables).

create table if not exists public.course_assets (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.pdf_ingest_jobs (id) on delete cascade,
  study_material_id uuid references public.study_materials (id) on delete set null,
  type text not null check (type in ('table', 'figure', 'image')),
  source text not null check (
    source in (
      'structural_raster',
      'structural_vector',
      'vision_bbox',
      'table_markdown'
    )
  ),
  source_page integer not null check (source_page >= 1),
  asset_url text,
  markdown text,
  caption text not null default '',
  caption_embedding jsonb,
  bbox jsonb,
  created_at timestamptz not null default now()
);

create index if not exists course_assets_job_id_idx
  on public.course_assets (job_id);

create index if not exists course_assets_study_material_id_idx
  on public.course_assets (study_material_id)
  where study_material_id is not null;

create index if not exists course_assets_job_page_idx
  on public.course_assets (job_id, source_page);

comment on table public.course_assets is
  'PDF-derived tables and figures extracted during enriching_sources. Phase 2 placement reads this table.';

alter table public.course_assets enable row level security;

drop policy if exists "course_assets_select_own_job" on public.course_assets;
create policy "course_assets_select_own_job"
  on public.course_assets
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.pdf_ingest_jobs j
      where j.id = course_assets.job_id
        and j.user_id = auth.uid()
    )
  );
