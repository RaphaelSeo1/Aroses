-- Persist non-deck files attached to a live-notes session so later
-- reconciliation uses the same authoritative sources regardless of upload order.

create table if not exists public.live_lecture_note_sources (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.live_lecture_sessions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  source_kind text not null default 'attachment',
  name text not null default 'Uploaded material',
  source_hash text not null,
  extracted_text text not null,
  created_at timestamptz not null default now(),

  unique (session_id, source_hash)
);

create index if not exists live_lecture_note_sources_session_idx
  on public.live_lecture_note_sources (session_id, created_at);

alter table public.live_lecture_note_sources enable row level security;

drop policy if exists "live_lecture_note_sources_own" on public.live_lecture_note_sources;
create policy "live_lecture_note_sources_own"
  on public.live_lecture_note_sources for all
  to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.live_lecture_sessions s
      where s.id = session_id and s.user_id = auth.uid()
    )
  );

comment on table public.live_lecture_note_sources is
  'Extracted user files used as durable evidence for source-order-independent live-note reconciliation.';
