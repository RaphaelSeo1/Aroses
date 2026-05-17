-- 4-button SM-2 spaced repetition layer.
--
-- Adds:
--   - `user_module_card_srs`  : per-user SRS state for module-bank questions
--                                (which live as JSON inside study_materials).
--   - `last_reviewed_at`      : new column on user_personal_quiz_items.
--   - `review_history`        : append-only rating log on both SRS surfaces.
--   - `user_srs_prefs`        : per-user defaults (daily limits, defaults).
--
-- The existing module quiz flow (single-pass via `question_attempts`) keeps
-- working — this table is additive. A rating is recorded by the new
-- /api/srs/rate endpoint, which also appends an attempt row for stats.

-- ---------------------------------------------------------------------------
-- 1. Per-user SRS state for module-bank questions
-- ---------------------------------------------------------------------------
create table if not exists public.user_module_card_srs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  material_id uuid not null references public.study_materials (id) on delete cascade,
  -- Stable identity: moduleId * 1000 + quizIndex (matches `question_attempts`).
  question_index int not null,
  srs_ease real not null default 2.5,
  srs_interval_days real not null default 0,
  srs_reps int not null default 0,
  due_at timestamptz not null default now(),
  last_reviewed_at timestamptz,
  -- Array of { at: iso8601, rating: again|hard|good|easy } for analytics.
  review_history jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, material_id, question_index)
);

create index if not exists user_module_card_srs_due_idx
  on public.user_module_card_srs (user_id, due_at);

create index if not exists user_module_card_srs_material_idx
  on public.user_module_card_srs (user_id, material_id, due_at);

alter table public.user_module_card_srs enable row level security;

create policy "Users read own module card srs"
  on public.user_module_card_srs for select
  using (auth.uid() = user_id);

create policy "Users insert own module card srs"
  on public.user_module_card_srs for insert
  with check (auth.uid() = user_id);

create policy "Users update own module card srs"
  on public.user_module_card_srs for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users delete own module card srs"
  on public.user_module_card_srs for delete
  using (auth.uid() = user_id);

comment on table public.user_module_card_srs is
  'Per-user SM-2 state for shared module-bank questions (JSON cards in study_materials).';
comment on column public.user_module_card_srs.question_index is
  'moduleId * 1000 + quizIndex — same encoding as question_attempts.question_index.';

-- ---------------------------------------------------------------------------
-- 2. Top up personal cards with the same metadata
-- ---------------------------------------------------------------------------
alter table public.user_personal_quiz_items
  add column if not exists last_reviewed_at timestamptz,
  add column if not exists review_history jsonb not null default '[]'::jsonb;

comment on column public.user_personal_quiz_items.review_history is
  'Append-only [{at, rating}] log of 4-button SM-2 ratings.';

-- ---------------------------------------------------------------------------
-- 3. User preferences (small JSON blob keyed by user)
-- ---------------------------------------------------------------------------
create table if not exists public.user_srs_prefs (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- Daily caps
  new_cards_per_day int not null default 20 check (new_cards_per_day >= 0 and new_cards_per_day <= 500),
  max_reviews_per_day int not null default 100 check (max_reviews_per_day >= 0 and max_reviews_per_day <= 2000),
  -- Global Review dashboard default course selection:
  --   'all'   - preselect every course
  --   'last'  - preselect whatever they used last time
  --   'none'  - nothing preselected, user picks every time
  default_dashboard_selection text not null default 'all'
    check (default_dashboard_selection in ('all', 'last', 'none')),
  show_course_badge boolean not null default true,
  daily_review_goal int not null default 30 check (daily_review_goal >= 0 and daily_review_goal <= 1000),
  -- Free-form last selection (course ids + review-type filter) so we can
  -- honor `default_dashboard_selection = 'last'` without adding tables.
  last_dashboard_state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_srs_prefs enable row level security;

create policy "Users manage own srs prefs"
  on public.user_srs_prefs for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

comment on table public.user_srs_prefs is
  'Per-user knobs for the SM-2 review system (daily limits, dashboard defaults).';
