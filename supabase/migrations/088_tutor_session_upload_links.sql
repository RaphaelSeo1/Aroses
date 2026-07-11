-- Track original URL for tutor session link reference materials.
-- file_kind may be 'link'; fetched page text is still stored under storage_path.

alter table public.tutor_session_uploads
  add column if not exists source_url text;

comment on column public.tutor_session_uploads.source_url is
  'Original URL when file_kind = link; null for file uploads.';
