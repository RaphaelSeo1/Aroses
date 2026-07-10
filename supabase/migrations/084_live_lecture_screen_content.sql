-- 084_live_lecture_screen_content.sql
--
-- Slide / screen extracts from live display capture. One row per detected
-- content transition (vision call). Used as a second factual source beside
-- the transcript for note synthesis and wrap-up course generation.

create table if not exists public.live_lecture_screen_content (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.live_lecture_sessions (id) on delete cascade,
  seq integer not null,
  at_ms integer not null default 0,
  title text,
  extracted_text text not null default '',
  table_markdown text,
  created_at timestamptz not null default now(),

  unique (session_id, seq)
);

create index if not exists live_lecture_screen_content_session_idx
  on public.live_lecture_screen_content (session_id, seq);

alter table public.live_lecture_screen_content enable row level security;

drop policy if exists "live_lecture_screen_content_own" on public.live_lecture_screen_content;
create policy "live_lecture_screen_content_own"
  on public.live_lecture_screen_content for all
  to authenticated
  using (
    exists (
      select 1 from public.live_lecture_sessions s
      where s.id = session_id and s.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.live_lecture_sessions s
      where s.id = session_id and s.user_id = auth.uid()
    )
  );

-- Per-session vision call counter (runaway / cost guard).
alter table public.live_lecture_sessions
  add column if not exists screen_vision_calls integer not null default 0;

comment on table public.live_lecture_screen_content is
  'On-screen slide extracts from live display capture (vision on transitions only).';
comment on column public.live_lecture_sessions.screen_vision_calls is
  'Haiku screen-vision calls made for this session (capped server-side).';
