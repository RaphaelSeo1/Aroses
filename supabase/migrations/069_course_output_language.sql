-- Language for AI-generated lesson + quiz text (not app UI localization).

alter table public.courses
  add column if not exists output_language text not null default 'auto'
  check (output_language in ('en', 'ko', 'auto'));

alter table public.pdf_ingest_jobs
  add column if not exists output_language text not null default 'auto'
  check (output_language in ('en', 'ko', 'auto'));

comment on column public.courses.output_language is
  'Default language for generated lessons/quizzes: en, ko, or auto (match source).';

comment on column public.pdf_ingest_jobs.output_language is
  'Per-upload override for generated lesson/quiz language.';
