-- Upgrade path if you already ran an older 001 without course platform columns.
-- Safe to run multiple times.

alter table public.study_materials
  add column if not exists course_payload jsonb not null default '{}';

create table if not exists public.module_completion (
  user_id uuid not null references auth.users (id) on delete cascade,
  material_id uuid not null references public.study_materials (id) on delete cascade,
  module_id int not null,
  completed_at timestamptz not null default now(),
  primary key (user_id, material_id, module_id)
);

create index if not exists module_completion_material_idx
  on public.module_completion (material_id);

alter table public.module_completion enable row level security;

drop policy if exists "Users manage own module completion" on public.module_completion;

create policy "Users manage own module completion"
  on public.module_completion
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter table public.question_attempts drop constraint if exists question_attempts_question_index_check;

alter table public.question_attempts drop constraint if exists question_attempts_question_index_bounds;

alter table public.question_attempts
  add constraint question_attempts_question_index_bounds
  check (question_index >= 0 and question_index < 1000000);
