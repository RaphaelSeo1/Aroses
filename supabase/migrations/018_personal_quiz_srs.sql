-- Spaced repetition fields for personal focus cards (Anki-like scheduling).

alter table public.user_personal_quiz_items
  add column if not exists srs_ease real not null default 2.5,
  add column if not exists srs_interval_days real not null default 0,
  add column if not exists srs_reps int not null default 0,
  add column if not exists due_at timestamptz not null default now();

comment on column public.user_personal_quiz_items.due_at is 'When this card is due for review (SM-2-style scheduling).';
comment on column public.user_personal_quiz_items.srs_ease is 'Ease factor (minimum 1.3).';
