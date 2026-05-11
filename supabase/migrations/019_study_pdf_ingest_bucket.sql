-- Private bucket: browser uploads PDFs directly to Storage (bypasses Vercel’s ~4.5 MB
-- serverless request body limit). The app downloads + deletes via service role after processing.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'study-pdf-ingest',
  'study-pdf-ingest',
  false,
  41943040,
  array['application/pdf']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "pdf_ingest_insert_own" on storage.objects;
create policy "pdf_ingest_insert_own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'study-pdf-ingest'
    and split_part(name, '/', 1) = auth.uid()::text
  );

drop policy if exists "pdf_ingest_select_own" on storage.objects;
create policy "pdf_ingest_select_own"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'study-pdf-ingest'
    and split_part(name, '/', 1) = auth.uid()::text
  );

drop policy if exists "pdf_ingest_delete_own" on storage.objects;
create policy "pdf_ingest_delete_own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'study-pdf-ingest'
    and split_part(name, '/', 1) = auth.uid()::text
  );
