-- Run this in the Supabase SQL Editor after creating your project.

-- User-created courses (title + description before upload)
create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  description text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists courses_user_created_idx
  on public.courses (user_id, created_at desc);

alter table public.courses enable row level security;

create policy "Users manage own courses"
  on public.courses
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Study materials (AI output per upload), tied to a user course
create table if not exists public.study_materials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  file_name text not null,
  summary text not null default '',
  key_concepts text[] not null default '{}',
  questions jsonb not null default '[]',
  course_payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists study_materials_user_course_idx
  on public.study_materials (user_id, course_id, created_at desc);

-- Per-question attempts (progress across sessions)
create table if not exists public.question_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  material_id uuid not null references public.study_materials (id) on delete cascade,
  question_index int not null check (question_index >= 0 and question_index < 1000000),
  selected_choice int not null check (selected_choice >= 0 and selected_choice <= 3),
  is_correct boolean not null,
  answered_at timestamptz not null default now()
);

create index if not exists question_attempts_user_material_idx
  on public.question_attempts (user_id, material_id, answered_at desc);

-- Per-module completion (course-style progress)
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

create policy "Users manage own module completion"
  on public.module_completion
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter table public.study_materials enable row level security;
alter table public.question_attempts enable row level security;

create policy "Users manage own study materials"
  on public.study_materials
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users manage own question attempts"
  on public.question_attempts
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
