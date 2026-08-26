-- 102_live_lecture_slide_pages.sql
--
-- Pre-uploaded lecture deck (PDF / PPTX) extracted to per-page text so live
-- note synthesis can match the current transcript to the right slides.

alter table public.live_lecture_sessions
  add column if not exists slides_storage_path text,
  add column if not exists slides_file_name text,
  add column if not exists slides_page_count integer not null default 0;

comment on column public.live_lecture_sessions.slides_storage_path is
  'Object key in study-pdf-ingest for the uploaded deck ({userId}/{uuid}.{ext}).';
comment on column public.live_lecture_sessions.slides_file_name is
  'Original file name of the uploaded lecture deck.';
comment on column public.live_lecture_sessions.slides_page_count is
  'Number of extracted slide/pages stored for this session.';

create table if not exists public.live_lecture_slide_pages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.live_lecture_sessions (id) on delete cascade,
  page_num integer not null,
  title text not null default '',
  extracted_text text not null default '',
  created_at timestamptz not null default now(),

  unique (session_id, page_num)
);

create index if not exists live_lecture_slide_pages_session_idx
  on public.live_lecture_slide_pages (session_id, page_num);

alter table public.live_lecture_slide_pages enable row level security;

drop policy if exists "live_lecture_slide_pages_own" on public.live_lecture_slide_pages;
create policy "live_lecture_slide_pages_own"
  on public.live_lecture_slide_pages for all
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

comment on table public.live_lecture_slide_pages is
  'Per-page text from a student-uploaded lecture deck, used as a third grounding source beside transcript and live screen OCR.';
