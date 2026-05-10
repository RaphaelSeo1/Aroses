-- Exam groups: Midterm 1, Final, etc. Materials belong to exactly one group per course.

create table if not exists public.exam_groups (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists exam_groups_course_sort_idx
  on public.exam_groups (course_id, sort_order, created_at);

alter table public.exam_groups enable row level security;

create policy "Users manage own exam groups"
  on public.exam_groups
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter table public.study_materials
  add column if not exists exam_group_id uuid references public.exam_groups (id) on delete cascade;

-- Backfill: one "General" group per course that has materials without a group
insert into public.exam_groups (course_id, user_id, name, sort_order)
select c.id, c.user_id, 'General', 0
from public.courses c
where exists (
  select 1 from public.study_materials sm
  where sm.course_id = c.id and sm.exam_group_id is null
)
and not exists (
  select 1 from public.exam_groups eg where eg.course_id = c.id
);

update public.study_materials sm
set exam_group_id = eg.id
from public.exam_groups eg
where sm.course_id = eg.course_id
  and sm.exam_group_id is null
  and eg.name = 'General';

create index if not exists study_materials_exam_group_idx
  on public.study_materials (exam_group_id, created_at desc);

alter table public.study_materials
  alter column exam_group_id set not null;
