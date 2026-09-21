-- Soft-delete for notes-focus Review decks (Deleted area on Review).
-- Module materials already use study_materials.deleted_at (migration 112).

alter table public.user_personal_quiz_items
  add column if not exists deleted_at timestamptz;

create index if not exists user_personal_quiz_items_user_deleted_idx
  on public.user_personal_quiz_items (user_id, deleted_at desc)
  where deleted_at is not null;

create index if not exists user_personal_quiz_items_active_due_idx
  on public.user_personal_quiz_items (user_id, due_at)
  where deleted_at is null;

comment on column public.user_personal_quiz_items.deleted_at is
  'When set, this focus card is in Deleted on Review and hidden from active decks.';
