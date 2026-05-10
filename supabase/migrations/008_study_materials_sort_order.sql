-- Manual ordering of uploads ("builds") within each exam group.

alter table public.study_materials
  add column if not exists sort_order int not null default 0;

-- Preserve previous list order (newest first): sort_order 0 = most recently created.
with ranked as (
  select
    id,
    row_number() over (
      partition by exam_group_id
      order by created_at desc
    ) - 1 as ord
  from public.study_materials
)
update public.study_materials sm
set sort_order = ranked.ord
from ranked
where sm.id = ranked.id;

create index if not exists study_materials_exam_group_sort_idx
  on public.study_materials (exam_group_id, sort_order);
