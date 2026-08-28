-- 105_user_calendar_items.sql
--
-- Personal calendar: todos, timed events, and important dates. Owned by
-- one user; RLS so only they can read/write their rows. Rose chat and
-- the home widget both talk to this table via /api/calendar.

create table if not exists public.user_calendar_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  notes text not null default '',
  kind text not null default 'todo'
    check (kind in ('todo', 'event')),
  starts_at timestamptz,
  ends_at timestamptz,
  all_day boolean not null default true,
  important boolean not null default false,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_calendar_items_title_len check (char_length(title) between 1 and 200),
  constraint user_calendar_items_notes_len check (char_length(notes) <= 2000),
  constraint user_calendar_items_range check (
    ends_at is null or starts_at is null or ends_at >= starts_at
  )
);

create index if not exists user_calendar_items_user_starts_idx
  on public.user_calendar_items (user_id, starts_at);

create index if not exists user_calendar_items_user_updated_idx
  on public.user_calendar_items (user_id, updated_at desc);

alter table public.user_calendar_items enable row level security;

create policy "Users manage own calendar items"
  on public.user_calendar_items for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

comment on table public.user_calendar_items is
  'Personal todos and calendar events. Optional starts_at (due/when); completed_at for todos.';
