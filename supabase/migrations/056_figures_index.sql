-- Catalog of figures extracted from uploads + per-lesson assignment metadata.

alter table public.study_materials
  add column if not exists figures_index jsonb;

comment on column public.study_materials.figures_index is
  'Extracted upload figures and per-lesson figure ids for excerpt / attribution UI.';
