-- Live preview for the build screen: while a module is being written, the
-- worker saves the lessons streamed so far (about once a second) so the
-- student can watch the text appear. Only the worker that holds the step
-- writes it; the build screen only reads it (owner-select RLS from 115).

alter table public.course_build_steps
  add column if not exists preview jsonb;

alter table public.course_build_steps
  add column if not exists preview_at timestamptz;

comment on column public.course_build_steps.preview is
  'Partial module output while the step runs: { lessons: [{ title, content }], quiz: n }.';
