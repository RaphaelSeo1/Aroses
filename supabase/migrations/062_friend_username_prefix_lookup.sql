-- Prefix username search for friend requests (exact match still preferred in app code).

create or replace function public.lookup_profiles_by_username_prefix(p_prefix text)
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
  where p.username is not null
    and char_length(trim(p_prefix)) >= 2
    and lower(p.username) like lower(trim(p_prefix)) || '%'
  order by
    case when lower(p.username) = lower(trim(p_prefix)) then 0 else 1 end,
    length(p.username),
    p.username
  limit 10;
$$;

revoke all on function public.lookup_profiles_by_username_prefix(text) from public;
grant execute on function public.lookup_profiles_by_username_prefix(text) to authenticated;
