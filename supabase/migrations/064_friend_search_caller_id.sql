-- Friend search: pass caller id explicitly (do not rely on auth.uid() inside RPC).

drop function if exists public.search_profiles_for_friend_add(text);

create or replace function public.search_profiles_for_friend_add(
  p_query text,
  p_exclude_user_id uuid
)
returns table (
  id uuid,
  display_name text,
  username text,
  avatar_url text
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.display_name, p.username, p.avatar_url
  from public.profiles p
  where p.id <> p_exclude_user_id
    and char_length(trim(p_query)) >= 2
    and (
      (
        p.username is not null
        and trim(p.username) <> ''
        and lower(p.username) like lower(trim(p_query)) || '%'
      )
      or (
        p.display_name is not null
        and trim(p.display_name) <> ''
        and lower(trim(p.display_name)) like lower(trim(p_query)) || '%'
      )
    )
  order by
    case
      when p.username is not null and lower(trim(p.username)) = lower(trim(p_query)) then 0
      when p.display_name is not null and lower(trim(p.display_name)) = lower(trim(p_query)) then 1
      when p.username is not null and lower(p.username) like lower(trim(p_query)) || '%' then 2
      else 3
    end,
    length(coalesce(nullif(trim(p.username), ''), trim(p.display_name), '')),
    coalesce(p.username, p.display_name)
  limit 10;
$$;

revoke all on function public.search_profiles_for_friend_add(text, uuid) from public;
grant execute on function public.search_profiles_for_friend_add(text, uuid) to authenticated;
