-- Per-course toggle: show school chip on Explore (inherits creator school when tagged school is empty).

alter table public.courses
  add column if not exists show_school_label boolean not null default true;

comment on column public.courses.show_school_label is
  'When true, Explore shows school chip (course.school_name or creator profile school). When false, no school label.';
