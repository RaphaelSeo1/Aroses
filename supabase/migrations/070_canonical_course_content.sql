-- Canonical course content (generated once) + per-upload display locale.
-- course_payload remains the locale the learner sees; canonical_payload is the
-- language-neutral source of truth for structure and facts.

alter table public.study_materials
  add column if not exists canonical_payload jsonb,
  add column if not exists base_locale text check (base_locale is null or base_locale in ('en', 'ko')),
  add column if not exists display_locale text check (display_locale is null or display_locale in ('en', 'ko')),
  add column if not exists content_source_key text;

create index if not exists study_materials_course_source_key_idx
  on public.study_materials (course_id, content_source_key)
  where content_source_key is not null and canonical_payload is not null;

comment on column public.study_materials.canonical_payload is
  'Source-of-truth course JSON in base_locale (structure + facts). Null on legacy rows.';
comment on column public.study_materials.base_locale is
  'Locale of canonical_payload (detected from source material at generation).';
comment on column public.study_materials.display_locale is
  'Locale of course_payload shown to the learner.';
comment on column public.study_materials.content_source_key is
  'Fingerprint of extracted source text + file name; links duplicate uploads to one canonical.';
