-- 090_user_notes_hub_note_folders.sql
--
-- Map any Notes hub card (standalone / live / tutor / course) into a custom
-- folder. Standalone notes also keep user_notes.section_id as the primary
-- placement; this column covers the other kinds and acts as a backup map.

alter table public.user_notes_hub_layout
  add column if not exists note_folders jsonb not null default '{}'::jsonb;

comment on column public.user_notes_hub_layout.note_folders is
  'Card key → custom section uuid. Keys like standalone-<id>, live-<id>, tutor-<id>, course-<materialId>.';
