-- 106_personal_quiz_note_source.sql
--
-- Focus questions can be generated from a notes selection (standalone
-- lecture notes, tutor notes, or course notes) without a course material.
-- material_id / module_id stay set when we can attach the card to a course.

alter table public.user_personal_quiz_items
  alter column material_id drop not null;

alter table public.user_personal_quiz_items
  alter column module_id drop not null;

alter table public.user_personal_quiz_items
  add column if not exists source_note_id uuid references public.user_notes (id) on delete set null,
  add column if not exists source_excerpt text,
  add column if not exists source_label text;

create index if not exists user_personal_quiz_items_source_note_idx
  on public.user_personal_quiz_items (user_id, source_note_id)
  where source_note_id is not null;

create index if not exists user_personal_quiz_items_notes_bucket_idx
  on public.user_personal_quiz_items (user_id, due_at)
  where material_id is null;

comment on column public.user_personal_quiz_items.source_note_id is
  'Standalone user_notes row this focus card was generated from, when known.';
comment on column public.user_personal_quiz_items.source_excerpt is
  'Learner-selected note text used to generate this card.';
comment on column public.user_personal_quiz_items.source_label is
  'Display name for Review when the card is not tied to a study material.';
