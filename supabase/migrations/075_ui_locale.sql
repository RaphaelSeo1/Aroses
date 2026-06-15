-- UI language preference for the app chrome (separate from courses.output_language,
-- which controls AI-generated course content).
alter table public.profiles
  add column if not exists ui_locale text not null default 'en';

alter table public.profiles
  drop constraint if exists profiles_ui_locale_check;

alter table public.profiles
  add constraint profiles_ui_locale_check
  check (ui_locale in ('en', 'ko'));
