-- Product tour completion (post-onboarding guided walkthrough).
alter table public.profiles
  add column if not exists product_tour_completed_at timestamptz;

comment on column public.profiles.product_tour_completed_at is
  'When the user finished or skipped the multi-page product tour; null means not completed.';
