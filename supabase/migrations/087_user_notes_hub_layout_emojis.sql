-- 087_user_notes_hub_layout_emojis.sql
--
-- Persist custom emoji icons for built-in Notes hub sections
-- (My notes, Live lectures, Tutor sessions, Course notes).

alter table public.user_notes_hub_layout
  add column if not exists section_emojis jsonb not null default '{}'::jsonb;

comment on column public.user_notes_hub_layout.section_emojis is
  'Map of built-in section id → emoji (standalone, live, tutor, course).';
