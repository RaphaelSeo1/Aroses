-- Persist the auto-generate notes toggle per tutor session (mirrors
-- user_course_notes.auto_generate on the mentored path).

alter table public.tutor_sessions
  add column if not exists auto_generate_notes boolean not null default false;
