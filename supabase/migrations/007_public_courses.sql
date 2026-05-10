-- Allow courses to appear on the public Explore page.

alter table public.courses
  add column if not exists is_public boolean not null default false;

create index if not exists courses_public_created_idx
  on public.courses (is_public, created_at desc);

-- Readable by anonymous and logged-in visitors when marked public (OR with existing own-row policy).
drop policy if exists "Anyone can read public courses" on public.courses;

create policy "Anyone can read public courses"
  on public.courses
  for select
  using (is_public = true);
