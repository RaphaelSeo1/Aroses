-- Mentored Learning mode: per-course onboarding + active tutoring sessions.
--
-- Adds:
--   - `user_course_onboarding`   : one row per (user, material). Stores the
--                                   short onboarding answers (goals, prior
--                                   background, knowledge-level quiz result,
--                                   personalized-vs-original path choice, and
--                                   the student's preferred interaction mode
--                                   for that course — voice or text).
--   - `user_mentored_sessions`   : the resumable lesson position when the
--                                   student is in Mentored Learning mode
--                                   (current module, chunk inside the module,
--                                   short recap of what was last covered).
--   - `user_course_mode_prefs`   : remembers which mode each course is
--                                   currently in ("mentored" or "free")
--                                   so switching is sticky across visits.
--
-- This layer is additive — module/lesson content, the SRS layer, and the
-- existing voice-tutor / highlight / notes systems are untouched.

-- ---------------------------------------------------------------------------
-- 1. Onboarding answers — one row per (user, material)
-- ---------------------------------------------------------------------------
create table if not exists public.user_course_onboarding (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  material_id uuid not null references public.study_materials (id) on delete cascade,

  -- 2-3 free-text answers about goals & prior familiarity.
  -- Shape: [{ question: string, answer: string }]
  goals jsonb not null default '[]'::jsonb,

  -- 'beginner' | 'intermediate' | 'advanced' — derived from the quiz score
  -- but the student can override on the path-choice screen.
  knowledge_level text not null default 'beginner'
    check (knowledge_level in ('beginner', 'intermediate', 'advanced')),

  -- The quiz itself + the student's answers.
  -- Shape: { questions: CourseQuizItem[], answers: number[], scorePct: number }
  level_quiz jsonb not null default '{}'::jsonb,

  -- Which course outline did the student choose to follow?
  --   'personalized' — sections reordered/adjusted based on quiz results
  --   'original'     — original outline as generated
  path_choice text not null default 'original'
    check (path_choice in ('personalized', 'original')),

  -- Interaction preference for Mentored Learning sessions of this course.
  --   'voice' — AI speaks every chunk, mic auto-listens, text input as fallback
  --   'text' — chunks shown as text; voice only when user opts in per chunk
  interaction_mode text not null default 'voice'
    check (interaction_mode in ('voice', 'text')),

  -- Marks completion of the onboarding flow. Until this is true the student
  -- sees the onboarding overlay every time they open the course in Mentored
  -- Learning mode.
  completed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, material_id)
);

create index if not exists user_course_onboarding_lookup_idx
  on public.user_course_onboarding (user_id, material_id);

alter table public.user_course_onboarding enable row level security;

create policy "Users manage own course onboarding"
  on public.user_course_onboarding for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

comment on table public.user_course_onboarding is
  'Per-(user, material) onboarding answers driving Mentored Learning personalization.';

-- ---------------------------------------------------------------------------
-- 2. Active mentored-learning session state — resumable per (user, material)
-- ---------------------------------------------------------------------------
create table if not exists public.user_mentored_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  material_id uuid not null references public.study_materials (id) on delete cascade,

  -- Where the student currently is. `module_id` is the CourseModule.id from
  -- the JSON payload (a small int). chunk_index tracks position inside the
  -- module's chunked lesson plan (see `lesson_plan` below).
  module_id int not null default 0,
  chunk_index int not null default 0,

  -- The current module's chunked lesson plan, as produced by Claude.
  -- Cached so we don't regenerate on every reload. Cleared when the student
  -- advances modules.
  -- Shape: { moduleId: int, chunks: MentoredLessonChunk[] }
  lesson_plan jsonb,

  -- Short natural-language recap of what was just covered. The
  -- "welcome back" greeting reads from this on resume.
  last_recap text,

  -- Tracks how the current check question has gone. Reset between chunks.
  -- Shape: { chunkIndex: int, attempts: int, lastEval: 'correct'|'partial'|'wrong'|null }
  attempt_state jsonb not null default '{}'::jsonb,

  -- Append-only log of completed chunks for analytics + recap.
  -- Shape: [{ at, moduleId, chunkIndex, concept, evaluation }]
  history jsonb not null default '[]'::jsonb,

  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, material_id)
);

create index if not exists user_mentored_sessions_lookup_idx
  on public.user_mentored_sessions (user_id, material_id);

alter table public.user_mentored_sessions enable row level security;

create policy "Users manage own mentored sessions"
  on public.user_mentored_sessions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

comment on table public.user_mentored_sessions is
  'Resumable Mentored Learning position + cached lesson plan per (user, material).';

-- ---------------------------------------------------------------------------
-- 3. Per-(user, material) selected mode — Mentored vs. Free Exploration
-- ---------------------------------------------------------------------------
create table if not exists public.user_course_mode_prefs (
  user_id uuid not null references auth.users (id) on delete cascade,
  material_id uuid not null references public.study_materials (id) on delete cascade,
  -- 'mentored' is the default for new courses; the student can toggle to
  -- 'free' (the existing read-at-your-own-pace experience) at any time.
  mode text not null default 'mentored'
    check (mode in ('mentored', 'free')),
  updated_at timestamptz not null default now(),
  primary key (user_id, material_id)
);

alter table public.user_course_mode_prefs enable row level security;

create policy "Users manage own course mode prefs"
  on public.user_course_mode_prefs for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

comment on table public.user_course_mode_prefs is
  'Which mode (Mentored vs. Free Exploration) each course is currently in for the student.';
