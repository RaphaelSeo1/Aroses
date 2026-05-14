-- Self Study Mode: private, personalized study sessions tied to a specific goal description.
-- is_self_study  → hides the course from the explore page and changes the study UI tone.
-- study_context  → free-form text the user wrote at setup ("I have an exam in 2 days…").
--                  Injected into every AI generation call so Claude calibrates the course.

alter table public.courses
  add column if not exists is_self_study boolean not null default false,
  add column if not exists study_context  text;

-- Index: dashboard queries filter self-study courses separately
create index if not exists courses_is_self_study_idx on public.courses (is_self_study);

-- Explore page already filters on is_public; self-study courses have is_public=false by default
-- so no extra policy change is needed — they're already invisible to non-owners.
