-- Forum: pinned threads + view counts.
--
-- pinned    : admins (is_app_super_admin) can pin a thread to the top.
-- view_count: bumped once per thread open via a SECURITY DEFINER function so
--             anonymous and signed-in readers can both increment it without an
--             update policy (RLS otherwise restricts updates to owners/admins).

alter table public.forum_posts
  add column if not exists pinned boolean not null default false,
  add column if not exists view_count integer not null default 0;

create index if not exists forum_posts_pinned_idx
  on public.forum_posts (pinned, created_at desc);

-- Admin moderation: super admins can pin/edit and delete any thread.
drop policy if exists "Admins manage forum posts" on public.forum_posts;
create policy "Admins manage forum posts"
  on public.forum_posts for update to authenticated
  using (public.is_app_super_admin())
  with check (public.is_app_super_admin());

drop policy if exists "Admins delete forum posts" on public.forum_posts;
create policy "Admins delete forum posts"
  on public.forum_posts for delete to authenticated
  using (public.is_app_super_admin());

create or replace function public.forum_bump_views(p_post_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.forum_posts
    set view_count = view_count + 1
    where id = p_post_id;
end;
$$;

grant execute on function public.forum_bump_views(uuid) to anon, authenticated;
