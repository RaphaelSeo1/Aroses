-- 107_calendar_todo_sections.sql
--
-- Named groups on the calendar to-do list (e.g. Chem, Personal). Empty
-- sections can exist; deleting a section leaves its tasks unsectioned.

create table if not exists public.user_calendar_todo_sections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_calendar_todo_sections_title_len
    check (char_length(title) between 1 and 80)
);

create index if not exists user_calendar_todo_sections_user_sort_idx
  on public.user_calendar_todo_sections (user_id, sort_order asc, created_at asc);

alter table public.user_calendar_todo_sections enable row level security;

create policy "Users manage own calendar todo sections"
  on public.user_calendar_todo_sections for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter table public.user_calendar_items
  add column if not exists section_id uuid
    references public.user_calendar_todo_sections (id) on delete set null;

create index if not exists user_calendar_items_user_section_idx
  on public.user_calendar_items (user_id, section_id);

comment on table public.user_calendar_todo_sections is
  'Named groups for calendar to-do lists. Tasks point here via section_id.';
