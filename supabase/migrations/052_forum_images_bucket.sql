-- Public bucket for images embedded in forum posts.
--
-- The browser uploads images directly to Storage (same pattern as avatars,
-- migration 023); the public URL is then embedded into the post's TipTap doc.
-- World-readable so the forum renders for anyone; authenticated users may only
-- write to a folder named after their own uid (split_part(name, '/', 1)).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'forum-images',
  'forum-images',
  true,
  10485760, -- 10 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "forum_images_public_read" on storage.objects;
create policy "forum_images_public_read"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'forum-images');

drop policy if exists "forum_images_insert_own" on storage.objects;
create policy "forum_images_insert_own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'forum-images'
    and split_part(name, '/', 1) = auth.uid()::text
  );

drop policy if exists "forum_images_delete_own" on storage.objects;
create policy "forum_images_delete_own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'forum-images'
    and split_part(name, '/', 1) = auth.uid()::text
  );
