-- School discovery: course school tags, indexes, same-school friend suggestions.

alter table public.courses
  add column if not exists school_name text;

comment on column public.courses.school_name is
  'Optional school tag for Explore. When null, Explore falls back to the creator profile school_name.';

create index if not exists profiles_school_name_lower_idx
  on public.profiles (lower(trim(school_name)))
  where school_name is not null and trim(school_name) <> '';

create index if not exists courses_school_name_lower_idx
  on public.courses (lower(trim(school_name)))
  where school_name is not null and trim(school_name) <> '';

-- Suggest people who share the caller's school (exact normalized match).
-- Excludes self, accepted friends, pending either direction, and blocked.
create or replace function public.suggest_profiles_same_school(
  p_viewer_id uuid,
  p_limit int default 12
)
returns table (
  id uuid,
  display_name text,
  username text,
  avatar_url text,
  school_name text
)
language sql
stable
security definer
set search_path = public
as $$
  with viewer as (
    select lower(trim(p.school_name)) as school_key
    from public.profiles p
    where p.id = p_viewer_id
      and p.school_name is not null
      and trim(p.school_name) <> ''
  )
  select
    p.id,
    p.display_name,
    p.username,
    p.avatar_url,
    p.school_name
  from public.profiles p
  cross join viewer v
  where p.id <> p_viewer_id
    and p.school_name is not null
    and trim(p.school_name) <> ''
    and lower(trim(p.school_name)) = v.school_key
    and not exists (
      select 1
      from public.friendships f
      where (
          (f.requester_id = p_viewer_id and f.addressee_id = p.id)
          or (f.requester_id = p.id and f.addressee_id = p_viewer_id)
        )
        and f.status in ('pending', 'accepted', 'blocked')
    )
  order by
    coalesce(nullif(trim(p.display_name), ''), nullif(trim(p.username), ''), p.id::text)
  limit greatest(1, least(coalesce(p_limit, 12), 30));
$$;

revoke all on function public.suggest_profiles_same_school(uuid, int) from public;
grant execute on function public.suggest_profiles_same_school(uuid, int) to authenticated;
