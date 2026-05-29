-- Transcript review pause for audio/video before outline generation.

alter table public.pdf_ingest_jobs
  add column if not exists ingest_transcript text;

comment on column public.pdf_ingest_jobs.ingest_transcript is
  'Editable transcript text while ingest_phase = reviewing_transcript.';
