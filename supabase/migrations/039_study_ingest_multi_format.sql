-- Multi-format study ingest: widen storage bucket + job metadata for mixed uploads.

update storage.buckets
set
  file_size_limit = 524288000,
  allowed_mime_types = array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-powerpoint',
    'text/plain',
    'text/markdown',
    'application/rtf',
    'text/rtf',
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'image/heic',
    'image/heif',
    'audio/mpeg',
    'audio/wav',
    'audio/mp4',
    'audio/ogg',
    'video/mp4',
    'video/quicktime',
    'video/webm',
    'video/x-msvideo'
  ]
where id = 'study-pdf-ingest';

alter table public.pdf_ingest_jobs
  add column if not exists source_format text,
  add column if not exists source_files jsonb,
  add column if not exists retain_storage boolean not null default false,
  add column if not exists ingest_media jsonb;

alter table public.study_materials
  add column if not exists ingest_media jsonb;

comment on column public.pdf_ingest_jobs.source_files is
  'Optional batch: [{storagePath, originalFileName, kind}] when multiple files build one course.';
comment on column public.study_materials.ingest_media is
  'Retained audio/video for playback: {kind, storagePath, bucket, transcriptSegments?}';
