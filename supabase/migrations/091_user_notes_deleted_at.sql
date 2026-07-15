-- 091_user_notes_deleted_at.sql
-- Soft-delete for standalone Notes hub notes → Recently deleted.

alter table public.user_notes
  add column if not exists deleted_at timestamptz;

create index if not exists user_notes_user_deleted_idx
  on public.user_notes (user_id, deleted_at desc)
  where deleted_at is not null;

comment on column public.user_notes.deleted_at is
  'When set, the note is in Recently deleted and hidden from normal hub sections.';
