-- Courses a learner removed from Continue studying / progress tiles.
-- Does not delete progress; the course can be reopened from Explore or workspace.

create table if not exists public.user_study_course_dismissed (
  user_id uuid not null references auth.users (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  dismissed_at timestamptz not null default now(),
  primary key (user_id, course_id)
);

create index if not exists user_study_course_dismissed_user_idx
  on public.user_study_course_dismissed (user_id, dismissed_at desc);

alter table public.user_study_course_dismissed enable row level security;

create policy "Users manage own dismissed study courses"
  on public.user_study_course_dismissed for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

comment on table public.user_study_course_dismissed is
  'Per-user hide list for Continue studying carousel and progress By course tiles.';

grant select, insert, update, delete on public.user_study_course_dismissed to authenticated;
