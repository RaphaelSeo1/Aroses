-- Per-session "tell the AI how to write these notes" free text.
-- Optional, style-only; empty string means "generate notes exactly as today".
-- Scoped to one live recording / tutor session / mentored course onboarding
-- row — never a global profile setting.

alter table public.live_lecture_sessions
  add column if not exists note_instruction text not null default '';

alter table public.tutor_sessions
  add column if not exists note_instruction text not null default '';

-- Mentored notes are per-material within a course; the per-user-per-material
-- onboarding row is the existing home for mentored personalization.
alter table public.user_course_onboarding
  add column if not exists note_instruction text not null default '';

comment on column public.live_lecture_sessions.note_instruction is
  'Student''s free-text note-style request for this session (style/emphasis only, max ~300 chars, '''' = default).';
comment on column public.tutor_sessions.note_instruction is
  'Student''s free-text note-style request for this session (style/emphasis only, max ~300 chars, '''' = default).';
comment on column public.user_course_onboarding.note_instruction is
  'Student''s free-text note-style request for mentored notes of this course (style/emphasis only, max ~300 chars, '''' = default).';
