-- Per-upload study context.
--
-- Until now the learner's self-study goal lived on `courses.study_context` and
-- applied to **every** PDF in that course forever. Users asked for a way to
-- customise the goal on each individual upload ("for this lecture I want X,
-- for that one I want Y"), so this adds an optional column on the ingest job.
--
-- The runner reads `pdf_ingest_jobs.study_context` first and falls back to the
-- parent course's `study_context`, so existing rows keep working unchanged.

alter table public.pdf_ingest_jobs
  add column if not exists study_context text;
