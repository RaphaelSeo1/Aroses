-- Soft-delete for study materials → Deleted area on Review
-- (and hidden from active Review / course material lists until restored).

alter table public.study_materials
  add column if not exists deleted_at timestamptz;

create index if not exists study_materials_user_deleted_idx
  on public.study_materials (user_id, deleted_at desc)
  where deleted_at is not null;

comment on column public.study_materials.deleted_at is
  'When set, the material is in Deleted on Review and hidden from active lists.';
