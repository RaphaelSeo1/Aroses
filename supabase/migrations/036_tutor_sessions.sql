-- 036_tutor_sessions.sql
--
-- Tutor Sessions — open-ended one-on-one tutoring with Rose,
-- distinct from the course-based Mentored Learning flow. A session
-- holds:
--   - a conversation transcript (JSON array of {role, content, ts}
--     messages built up over the session)
--   - optional reference uploads (separate child table)
--   - live notes (TipTap doc the student takes during the session)
--   - an auto-generated recap (markdown, produced at end-of-session
--     by an AI call over the transcript + notes)
--
-- Sessions are NOT courses. They never appear in the course library,
-- never produce lesson plans, never have modules. They are listed
-- separately at /sessions.

create type public.tutor_session_mode as enum (
  'exam_prep',
  'homework_help',
  'concept_review',
  'quiz_me',
  'exploring'
);

create type public.tutor_session_status as enum ('active', 'ended');

create table if not exists public.tutor_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Auto-generated from the topic / first message; users don't pick
  -- it. Used in the sessions library and as the recap H1.
  title text not null default 'Untitled session',
  -- Free-text initial topic the student typed (if any).
  topic text not null default '',
  -- Optional mode tag. NULL = open exploration; affects Rose's
  -- system prompt.
  mode_tag public.tutor_session_mode,

  status public.tutor_session_status not null default 'active',
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_seconds integer,

  -- Full chat history: [{role:"user"|"assistant", content, ts}, ...]
  -- Updated on every turn. Capped at 200 messages soft (we trim
  -- older ones from the prompt but keep the DB row intact).
  conversation_transcript jsonb not null default '[]'::jsonb,

  -- Cached summary of all uploads (text snippet, ~2k chars) injected
  -- into Rose's system prompt every turn. Generated at upload time
  -- and updated on each new upload.
  reference_summary text not null default '',

  -- Running summary of what's been discussed so far. Updated every
  -- ~6 turns by a cheap Haiku call so the system prompt doesn't
  -- balloon with full history.
  discussion_summary text not null default '',

  -- Live TipTap doc + plain-text mirror.
  live_notes_json jsonb not null default
    '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb,
  live_notes_text text not null default '',

  -- AI-generated end-of-session recap. Markdown so we can render it
  -- with the same prose pipeline as lesson content.
  recap_markdown text,
  recap_generated_at timestamptz,
  -- 'idle' | 'generating' | 'ready' | 'failed' — drives the recap
  -- view's loading state.
  recap_status text not null default 'idle',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tutor_sessions_user_idx
  on public.tutor_sessions (user_id, created_at desc);

alter table public.tutor_sessions enable row level security;

create policy "owner can read tutor sessions"
  on public.tutor_sessions for select
  using (user_id = auth.uid());

create policy "owner can insert tutor sessions"
  on public.tutor_sessions for insert
  with check (user_id = auth.uid());

create policy "owner can update tutor sessions"
  on public.tutor_sessions for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "owner can delete tutor sessions"
  on public.tutor_sessions for delete
  using (user_id = auth.uid());

comment on table public.tutor_sessions is
  'One-on-one Rose tutoring sessions. Independent of the course system.';

-- ---------------------------------------------------------------------------
-- tutor_session_uploads — reference materials the student attaches
-- ---------------------------------------------------------------------------
--
-- These are CONTEXT for Rose, never a course. Each row stores the
-- storage path, the AI-generated content summary (used in prompts),
-- and metadata. PDFs are text-extracted; images go through Claude
-- vision; both produce a summary string we cache on the row.

create table if not exists public.tutor_session_uploads (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.tutor_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  file_name text not null,
  -- 'pdf' | 'image' | 'text' — drives extraction strategy.
  file_kind text not null,
  mime_type text,
  size_bytes integer,
  storage_path text not null,

  -- Extracted text (PDFs) or vision description (images), capped at
  -- ~30k chars on insert. Used to seed the summary.
  extracted_content text not null default '',
  -- AI-shrunk summary that lives in the session prompt (~600 chars).
  summary text not null default '',

  created_at timestamptz not null default now()
);

create index if not exists tutor_session_uploads_session_idx
  on public.tutor_session_uploads (session_id, created_at asc);

alter table public.tutor_session_uploads enable row level security;

create policy "owner can read their session uploads"
  on public.tutor_session_uploads for select
  using (user_id = auth.uid());

create policy "owner can insert session uploads"
  on public.tutor_session_uploads for insert
  with check (user_id = auth.uid());

create policy "owner can delete session uploads"
  on public.tutor_session_uploads for delete
  using (user_id = auth.uid());

comment on table public.tutor_session_uploads is
  'Reference materials attached to a tutor session. Pure context, never a course.';

-- ---------------------------------------------------------------------------
-- Storage bucket for raw upload bytes
-- ---------------------------------------------------------------------------
--
-- Private bucket. Files are written by authenticated users into a
-- folder prefixed by their auth.uid() so the policy can authorize
-- read/write by path prefix. Files are deleted on session delete via
-- a server-side cleanup (the storage policy permits it).

insert into storage.buckets (id, name, public)
values ('tutor-session-uploads', 'tutor-session-uploads', false)
on conflict (id) do nothing;

drop policy if exists "tutor session uploads — owner read" on storage.objects;
create policy "tutor session uploads — owner read"
  on storage.objects for select
  using (
    bucket_id = 'tutor-session-uploads'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "tutor session uploads — owner write" on storage.objects;
create policy "tutor session uploads — owner write"
  on storage.objects for insert
  with check (
    bucket_id = 'tutor-session-uploads'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "tutor session uploads — owner delete" on storage.objects;
create policy "tutor session uploads — owner delete"
  on storage.objects for delete
  using (
    bucket_id = 'tutor-session-uploads'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
