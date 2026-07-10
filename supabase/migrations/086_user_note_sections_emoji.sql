-- 086_user_note_sections_emoji.sql
--
-- Optional custom emoji icon for user-created Notes hub sections.

alter table public.user_note_sections
  add column if not exists emoji text;

comment on column public.user_note_sections.emoji is
  'Optional emoji icon for the section in the Notes hub sidebar.';
