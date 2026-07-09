-- 083_user_notes_hub_layout.sql
--
-- Persist sidebar section order for the Notes hub (built-in + custom folders).

create table if not exists public.user_notes_hub_layout (
  user_id uuid primary key references auth.users (id) on delete cascade,
  section_order jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_notes_hub_layout enable row level security;

create policy "Users manage own notes hub layout"
  on public.user_notes_hub_layout for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

comment on table public.user_notes_hub_layout is
  'Sidebar section order in /notes — array of section ids (standalone, custom:uuid, live, tutor, course).';
