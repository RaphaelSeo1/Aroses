-- Public community forum: posts, upvotes, and comments.
--
-- Anyone (anon or signed-in) can READ posts and comments so the forum is a
-- public, browsable place for feedback and course requests. Signed-in users
-- create and own their content. Author display names are denormalized onto the
-- rows (author_name) so the board renders without needing a public read policy
-- on `profiles` (which is intentionally own-row-only).
--
-- Vote and comment counts are denormalized onto forum_posts and kept current by
-- SECURITY DEFINER triggers (so a voter can bump a post they don't own without a
-- broad update policy).

create table if not exists public.forum_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  author_name text not null default 'Member',
  category text not null default 'discussion'
    check (category in ('course_request', 'feedback', 'discussion', 'bug')),
  title text not null,
  body text not null default '',
  vote_count integer not null default 0,
  comment_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists forum_posts_created_idx on public.forum_posts (created_at desc);
create index if not exists forum_posts_votes_idx on public.forum_posts (vote_count desc);
create index if not exists forum_posts_category_idx on public.forum_posts (category);

create table if not exists public.forum_post_votes (
  post_id uuid not null references public.forum_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table if not exists public.forum_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.forum_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  author_name text not null default 'Member',
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists forum_comments_post_idx on public.forum_comments (post_id, created_at);

-- RLS -----------------------------------------------------------------------
alter table public.forum_posts enable row level security;
alter table public.forum_post_votes enable row level security;
alter table public.forum_comments enable row level security;

-- Posts: world-readable; authenticated users create/own.
drop policy if exists "Anyone reads forum posts" on public.forum_posts;
create policy "Anyone reads forum posts"
  on public.forum_posts for select using (true);

drop policy if exists "Users create forum posts" on public.forum_posts;
create policy "Users create forum posts"
  on public.forum_posts for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users update own forum posts" on public.forum_posts;
create policy "Users update own forum posts"
  on public.forum_posts for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users delete own forum posts" on public.forum_posts;
create policy "Users delete own forum posts"
  on public.forum_posts for delete to authenticated
  using (auth.uid() = user_id);

-- Comments: world-readable; authenticated users create/own; delete own.
drop policy if exists "Anyone reads forum comments" on public.forum_comments;
create policy "Anyone reads forum comments"
  on public.forum_comments for select using (true);

drop policy if exists "Users create forum comments" on public.forum_comments;
create policy "Users create forum comments"
  on public.forum_comments for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users delete own forum comments" on public.forum_comments;
create policy "Users delete own forum comments"
  on public.forum_comments for delete to authenticated
  using (auth.uid() = user_id);

-- Votes: each user reads/adds/removes only their own vote rows. Public vote
-- totals are read from forum_posts.vote_count (trigger-maintained).
drop policy if exists "Users read own forum votes" on public.forum_post_votes;
create policy "Users read own forum votes"
  on public.forum_post_votes for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users add own forum votes" on public.forum_post_votes;
create policy "Users add own forum votes"
  on public.forum_post_votes for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users remove own forum votes" on public.forum_post_votes;
create policy "Users remove own forum votes"
  on public.forum_post_votes for delete to authenticated
  using (auth.uid() = user_id);

-- Denormalized counters (SECURITY DEFINER so a voter/commenter can bump a post
-- they don't own; functions only touch the counter columns) --------------------
create or replace function public.forum_bump_vote_count()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'INSERT') then
    update public.forum_posts set vote_count = vote_count + 1 where id = new.post_id;
    return new;
  elsif (tg_op = 'DELETE') then
    update public.forum_posts set vote_count = greatest(0, vote_count - 1) where id = old.post_id;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists forum_votes_count on public.forum_post_votes;
create trigger forum_votes_count
  after insert or delete on public.forum_post_votes
  for each row execute function public.forum_bump_vote_count();

create or replace function public.forum_bump_comment_count()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'INSERT') then
    update public.forum_posts set comment_count = comment_count + 1 where id = new.post_id;
    return new;
  elsif (tg_op = 'DELETE') then
    update public.forum_posts set comment_count = greatest(0, comment_count - 1) where id = old.post_id;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists forum_comments_count on public.forum_comments;
create trigger forum_comments_count
  after insert or delete on public.forum_comments
  for each row execute function public.forum_bump_comment_count();

create or replace function public.set_forum_posts_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists forum_posts_set_updated_at on public.forum_posts;
create trigger forum_posts_set_updated_at
  before update on public.forum_posts
  for each row execute function public.set_forum_posts_updated_at();

comment on table public.forum_posts is
  'Public community forum posts (feedback, course requests, discussion). World-readable; signed-in users own their rows.';
