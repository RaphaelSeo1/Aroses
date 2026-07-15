-- 092_hub_notes_soft_delete.sql
-- Soft-delete for live / tutor / course notes → Recently deleted (like standalone).

alter table public.tutor_sessions
  add column if not exists deleted_at timestamptz;

alter table public.live_lecture_sessions
  add column if not exists deleted_at timestamptz;

alter table public.user_course_notes
  add column if not exists deleted_at timestamptz;

create index if not exists tutor_sessions_user_deleted_idx
  on public.tutor_sessions (user_id, deleted_at desc)
  where deleted_at is not null;

create index if not exists live_lecture_sessions_user_deleted_idx
  on public.live_lecture_sessions (user_id, deleted_at desc)
  where deleted_at is not null;

create index if not exists user_course_notes_user_deleted_idx
  on public.user_course_notes (user_id, deleted_at desc)
  where deleted_at is not null;

comment on column public.tutor_sessions.deleted_at is
  'When set, the tutor session is in Recently deleted on the Notes hub.';

comment on column public.live_lecture_sessions.deleted_at is
  'When set, the live lecture is in Recently deleted on the Notes hub.';

comment on column public.user_course_notes.deleted_at is
  'When set, the course note is in Recently deleted on the Notes hub.';
