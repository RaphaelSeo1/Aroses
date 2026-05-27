-- Per-(user, course) activity + resume position for Mentored and Free Exploration.

create table if not exists public.user_course_progress (
  user_id uuid not null references auth.users (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  material_id uuid references public.study_materials (id) on delete set null,
  last_module_id int,
  last_lesson_index int not null default 0,
  last_mode text check (last_mode in ('mentored', 'free')),
  last_scroll_position int,
  last_chunk_index int not null default 0,
  completed_lesson_keys jsonb not null default '[]'::jsonb,
  last_interacted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, course_id)
);

create index if not exists user_course_progress_interacted_idx
  on public.user_course_progress (user_id, last_interacted_at desc);

create index if not exists user_course_progress_course_idx
  on public.user_course_progress (course_id);

alter table public.user_course_progress enable row level security;

create policy "Users manage own course progress"
  on public.user_course_progress for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

comment on table public.user_course_progress is
  'Single source of truth for where a student left off in a course and when they last interacted (home carousel + resume routing).';

grant select, insert, update, delete on public.user_course_progress to authenticated;
