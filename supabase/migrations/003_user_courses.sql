-- Upgrade path: migrate old schema that used course_slug (bio-1a / chem-1a)
-- Safe on DBs that already use courses + course_id (skips legacy block).

create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  description text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists courses_user_created_idx
  on public.courses (user_id, created_at desc);

alter table public.courses enable row level security;

drop policy if exists "Users manage own courses" on public.courses;

create policy "Users manage own courses"
  on public.courses
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter table public.study_materials
  add column if not exists course_id uuid references public.courses (id) on delete cascade;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'study_materials'
      and column_name = 'course_slug'
  ) then
    alter table public.courses add column if not exists legacy_slug text;

    insert into public.courses (user_id, title, description, legacy_slug)
    select distinct on (sm.user_id, sm.course_slug)
      sm.user_id,
      case sm.course_slug
        when 'bio-1a' then 'Bio 1A — General Biology'
        when 'chem-1a' then 'Chem 1A — General Chemistry'
        else initcap(replace(sm.course_slug, '-', ' '))
      end,
      'Imported from earlier Aroses.',
      sm.course_slug
    from public.study_materials sm
    where sm.course_id is null
      and sm.course_slug is not null
    order by sm.user_id, sm.course_slug;

    update public.study_materials sm
    set course_id = c.id
    from public.courses c
    where sm.course_id is null
      and c.user_id = sm.user_id
      and c.legacy_slug is not null
      and c.legacy_slug = sm.course_slug;

    alter table public.courses drop column if exists legacy_slug;

    alter table public.study_materials drop constraint if exists study_materials_course_slug_check;

    alter table public.study_materials drop column if exists course_slug;
  end if;
end $$;

drop index if exists study_materials_user_course_idx;

create index if not exists study_materials_user_course_idx
  on public.study_materials (user_id, course_id, created_at desc);
