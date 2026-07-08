-- 079_live_lecture_sessions.sql
--
-- Live Notes: live lecture capture sessions. The browser streams mic/tab audio
-- to Deepgram, flushes finalized transcript segments here every ~15s, and the
-- AI appends structured note blocks into a TipTap doc stored on the session.
-- On Stop the composed transcript is handed to the existing transcript-review
-- course pipeline (a `pdf_ingest_jobs` row parked at `reviewing_transcript`) —
-- the session itself is NOT an ingest job; `ingest_job_id` links the two.

create table if not exists public.live_lecture_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  exam_group_id uuid references public.exam_groups (id) on delete set null,
  title text not null default 'Live lecture',
  status text not null default 'recording'
    check (status in ('recording', 'paused', 'completed', 'failed')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,

  -- Rolling compressed summary of everything synthesized so far. Sent back to
  -- the model on each note-append call so context stays bounded on a
  -- 90-minute lecture (the model re-compresses it every call).
  rolling_summary text not null default '',

  -- TipTap ProseMirror doc + plain-text mirror — same shape as
  -- tutor_sessions.live_notes_json so the reused NotesPanel endpoint
  -- contract is identical.
  notes_json jsonb not null default '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb,
  notes_text text not null default '',

  -- Wrap-up handoff: the pdf_ingest_jobs row created at Stop.
  ingest_job_id uuid references public.pdf_ingest_jobs (id) on delete set null,

  -- Recorded (Deepgram-connected) seconds, updated on segment flush /
  -- complete. Used for voice metering.
  duration_seconds integer not null default 0,

  -- Deepgram seconds already recorded to the voice-usage meter (so repeated
  -- flushes only ever meter the delta).
  metered_seconds integer not null default 0,

  -- Note-append (Haiku) calls made for this session — server-side runaway
  -- guard on synthesis cost.
  synthesize_calls integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists live_lecture_sessions_user_idx
  on public.live_lecture_sessions (user_id, created_at desc);
create index if not exists live_lecture_sessions_course_idx
  on public.live_lecture_sessions (course_id, created_at desc);

alter table public.live_lecture_sessions enable row level security;

drop policy if exists "live_lecture_sessions_own" on public.live_lecture_sessions;
create policy "live_lecture_sessions_own"
  on public.live_lecture_sessions for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Finalized transcript segments, insert-only. `seq` is assigned client-side
-- from a monotonically increasing counter; the unique constraint makes flush
-- retries idempotent (upsert on conflict do nothing). `at_ms` is the offset
-- from session start so the composed transcript gets `[m:ss]` timestamps in
-- the same format the audio-upload path produces.
create table if not exists public.live_lecture_segments (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.live_lecture_sessions (id) on delete cascade,
  seq integer not null,
  text text not null,
  at_ms integer not null default 0,
  created_at timestamptz not null default now(),

  unique (session_id, seq)
);

create index if not exists live_lecture_segments_session_idx
  on public.live_lecture_segments (session_id, seq);

alter table public.live_lecture_segments enable row level security;

-- Segments are readable/writable only through the owning session.
drop policy if exists "live_lecture_segments_own" on public.live_lecture_segments;
create policy "live_lecture_segments_own"
  on public.live_lecture_segments for all
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

comment on table public.live_lecture_sessions is
  'Live Notes capture sessions: live Deepgram transcript + AI-appended TipTap notes doc. Converted to a course via pdf_ingest_jobs at wrap-up.';
comment on table public.live_lecture_segments is
  'Finalized live-transcript segments (insert-only), flushed from the browser every ~15s during a live lecture session.';
