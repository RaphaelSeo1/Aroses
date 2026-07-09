-- 081_user_notes_live_capture.sql
--
-- Standalone notes can run the same live audio capture + transcription +
-- AI note-taking flow as course live lectures. Sessions linked via
-- user_note_id; course_id is optional for these captures.

alter table public.live_lecture_sessions
  alter column course_id drop not null;

alter table public.live_lecture_sessions
  add column if not exists user_note_id uuid
    references public.user_notes (id) on delete cascade;

create index if not exists live_lecture_sessions_user_note_idx
  on public.live_lecture_sessions (user_note_id)
  where user_note_id is not null;

comment on column public.live_lecture_sessions.user_note_id is
  'When set, this capture belongs to a standalone note from the Notes hub (course_id may be null).';
