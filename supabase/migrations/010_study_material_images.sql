-- Public bucket for images embedded in lesson markdown (study_materials.course_payload).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'study-material-images',
  'study-material-images',
  true,
  5242880,
  array[
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/svg+xml'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "study_images_select_public" on storage.objects;
create policy "study_images_select_public"
  on storage.objects for select
  to public
  using (bucket_id = 'study-material-images');

drop policy if exists "study_images_insert_own" on storage.objects;
create policy "study_images_insert_own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'study-material-images'
    and split_part(name, '/', 1) = auth.uid()::text
  );

drop policy if exists "study_images_delete_own" on storage.objects;
create policy "study_images_delete_own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'study-material-images'
    and split_part(name, '/', 1) = auth.uid()::text
  );
