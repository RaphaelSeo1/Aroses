-- 085_user_notes_last_opened.sql
--
-- Track when a standalone note was last opened (viewed), separate from
-- content edits (updated_at). Home "Welcome back" uses the fresher of the two.

alter table public.user_notes
  add column if not exists last_opened_at timestamptz;

create index if not exists user_notes_user_opened_idx
  on public.user_notes (user_id, last_opened_at desc nulls last);

comment on column public.user_notes.last_opened_at is
  'Last time the student opened this note in the editor (view). Distinct from updated_at (content edit).';
