-- Fix Storage RLS for lesson images: use split_part so policies work even if
-- storage.foldername() behaves differently across Postgres versions.

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
