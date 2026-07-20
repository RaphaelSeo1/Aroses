-- Add General + Other forum categories and keep a stable ordered check list.
alter table public.forum_posts
  drop constraint if exists forum_posts_category_check;

alter table public.forum_posts
  add constraint forum_posts_category_check
  check (
    category in (
      'general',
      'course_request',
      'discussion',
      'feedback',
      'bug',
      'other'
    )
  );

alter table public.forum_posts
  alter column category set default 'general';
