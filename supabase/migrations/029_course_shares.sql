-- Course share links: private, unguessable URLs that grant read-only access to
-- a course (and its generated lessons + quizzes) for anyone who has the link.
-- Anonymous viewers do NOT need to be logged in.

create table if not exists public.course_shares (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  token text not null unique,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index if not exists course_shares_course_idx on public.course_shares (course_id);
create index if not exists course_shares_active_token_idx
  on public.course_shares (token)
  where revoked_at is null;

alter table public.course_shares enable row level security;

-- Owners (the user_id who created the share link) can read/manage their links.
-- Anonymous lookups happen server-side via the service role, NOT via this RLS,
-- so we don't grant any anonymous select policy here.

drop policy if exists "Owners manage their share links" on public.course_shares;
create policy "Owners manage their share links"
  on public.course_shares
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
