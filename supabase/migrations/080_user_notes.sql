-- 080_user_notes.sql
--
-- Standalone notes the user creates from the Notes hub — not tied to a
-- course material, tutor session, or live lecture. Same TipTap doc shape
-- as user_course_notes. Optional course_id / ingest_job_id after the
-- user chooses "Build course from these notes."

create table if not exists public.user_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default 'Untitled note',

  content_json jsonb not null default '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb,
  content_text text not null default '',

  course_id uuid references public.courses (id) on delete set null,
  ingest_job_id uuid references public.pdf_ingest_jobs (id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_notes_user_updated_idx
  on public.user_notes (user_id, updated_at desc);

alter table public.user_notes enable row level security;

create policy "Users manage own standalone notes"
  on public.user_notes for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

comment on table public.user_notes is
  'Freeform notes created from the Notes hub. Optional convert-to-course via pdf_ingest_jobs.';
