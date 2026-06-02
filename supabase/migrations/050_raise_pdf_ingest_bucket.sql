-- Raise the study ingest bucket size limit.
--
-- The `study-pdf-ingest` bucket was originally created at 40 MB (migration
-- 019). Migration 039 already widens it to 500 MB for multi-format uploads,
-- but some databases only have 019 applied — so PDFs over ~40 MB fail to
-- upload with "exceeded the maximum allowed size". This migration is an
-- idempotent re-apply that guarantees the bucket allows large uploads (up to
-- 500 MB; per-format caps such as 100 MB for PDFs are enforced in the app).

update storage.buckets
set file_size_limit = 524288000
where id = 'study-pdf-ingest';
