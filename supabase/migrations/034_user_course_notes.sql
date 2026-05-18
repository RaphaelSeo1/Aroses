-- 034_user_course_notes.sql
--
-- Adds `user_course_notes` — per (user, material) notes document the
-- student maintains during Mentored Learning. Stored as a TipTap
-- ProseMirror JSON doc plus a plain-text mirror for previews/search.
--
-- Why one row per (user, material) and not per lesson:
--   - The student keeps a single running notes doc per course, which
--     matches how note-taking actually works in practice.
--   - Lesson-scoped notes can be implemented later by adding section
--     dividers inside the doc; we don't need a separate row per lesson.

create table if not exists public.user_course_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  material_id uuid not null references public.study_materials(id) on delete cascade,

  -- TipTap ProseMirror JSON doc. Default = a minimal empty doc so
  -- the editor mounts cleanly the first time the student opens it.
  content_json jsonb not null default '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb,

  -- Plain-text mirror, computed by the API on every save. Used for
  -- previews on the course page and for substring search later.
  content_text text not null default '',

  -- When true, Rose appends AI-generated notes (concept + key points)
  -- directly into the doc as she teaches. When false, she only
  -- surfaces suggestions the student can choose to insert.
  auto_generate boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique(user_id, material_id)
);

create index if not exists user_course_notes_lookup_idx
  on public.user_course_notes (user_id, material_id);

alter table public.user_course_notes enable row level security;

create policy "Users manage own course notes"
  on public.user_course_notes for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

comment on table public.user_course_notes is
  'Per-(user, material) notes document the student writes during Mentored Learning. Stored as TipTap ProseMirror JSON.';
