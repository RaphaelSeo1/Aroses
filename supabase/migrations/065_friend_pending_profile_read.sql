-- Let users read display name / username for pending friend requests (either direction).

create or replace function public.users_share_friend_link(
  p_user_id uuid,
  p_other_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.friendships f
    where f.status in ('pending', 'accepted')
      and (
        (f.requester_id = p_user_id and f.addressee_id = p_other_id)
        or (f.requester_id = p_other_id and f.addressee_id = p_user_id)
      )
  );
$$;

revoke all on function public.users_share_friend_link(uuid, uuid) from public;
grant execute on function public.users_share_friend_link(uuid, uuid) to authenticated;

drop policy if exists "Friends read friend profiles" on public.profiles;

create policy "Friends read friend profiles"
  on public.profiles for select to authenticated
  using (
    id = auth.uid()
    or public.users_share_friend_link(auth.uid(), id)
  );
