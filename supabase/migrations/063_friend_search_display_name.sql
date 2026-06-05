-- Friend search by @username OR display name, plus backfill missing usernames.

create or replace function public.search_profiles_for_friend_add(p_query text)
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
  where auth.uid() is not null
    and p.id <> auth.uid()
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

revoke all on function public.search_profiles_for_friend_add(text) from public;
grant execute on function public.search_profiles_for_friend_add(text) to authenticated;

-- Backfill @username from display name when missing (legacy / partial onboarding saves).
update public.profiles p
set username = sub.candidate
from (
  select
    pr.id,
    left(
      lower(
        regexp_replace(
          regexp_replace(trim(pr.display_name), '[^a-zA-Z0-9_]+', '_', 'g'),
          '_+',
          '_',
          'g'
        )
      ),
      30
    ) as candidate
  from public.profiles pr
  where (pr.username is null or trim(pr.username) = '')
    and pr.display_name is not null
    and trim(pr.display_name) <> ''
) sub
where p.id = sub.id
  and sub.candidate ~ '^[a-z0-9_]{3,30}$'
  and not exists (
    select 1
    from public.profiles taken
    where taken.username is not null
      and lower(trim(taken.username)) = sub.candidate
      and taken.id <> p.id
  );
