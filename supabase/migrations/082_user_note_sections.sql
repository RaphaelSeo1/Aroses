-- 082_user_note_sections.sql
--
-- User-created folders for organizing standalone notes in the Notes hub.

create table if not exists public.user_note_sections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default 'New section',
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_note_sections_user_sort_idx
  on public.user_note_sections (user_id, sort_order asc, created_at asc);

alter table public.user_note_sections enable row level security;

create policy "Users manage own note sections"
  on public.user_note_sections for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter table public.user_notes
  add column if not exists section_id uuid
    references public.user_note_sections (id) on delete set null;

create index if not exists user_notes_section_idx
  on public.user_notes (user_id, section_id, updated_at desc);

comment on table public.user_note_sections is
  'Custom folders for standalone notes in the Notes hub.';
