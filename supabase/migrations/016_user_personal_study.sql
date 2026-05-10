-- Per-learner notes + AI-generated quiz items (never mixed into shared course_payload).

create table if not exists public.user_lesson_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  material_id uuid not null references public.study_materials (id) on delete cascade,
  module_id int not null,
  lesson_index int not null,
  highlight_excerpt text not null default '',
  note_body text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, material_id, module_id, lesson_index)
);

create index if not exists user_lesson_notes_lookup_idx
  on public.user_lesson_notes (user_id, material_id, module_id);

create table if not exists public.user_personal_quiz_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  material_id uuid not null references public.study_materials (id) on delete cascade,
  module_id int not null,
  item jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists user_personal_quiz_items_lookup_idx
  on public.user_personal_quiz_items (user_id, material_id, module_id);

create table if not exists public.user_personal_question_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  personal_item_id uuid not null references public.user_personal_quiz_items (id) on delete cascade,
  selected_choice int not null check (selected_choice >= 0 and selected_choice <= 5),
  is_correct boolean not null,
  answered_at timestamptz not null default now()
);

create index if not exists user_personal_attempts_item_idx
  on public.user_personal_question_attempts (user_id, personal_item_id, answered_at desc);

alter table public.user_lesson_notes enable row level security;
alter table public.user_personal_quiz_items enable row level security;
alter table public.user_personal_question_attempts enable row level security;

create policy "Users manage own lesson notes"
  on public.user_lesson_notes for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users manage own personal quiz items"
  on public.user_personal_quiz_items for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users manage own personal question attempts"
  on public.user_personal_question_attempts for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
