-- Onboarding questionnaire fields + public username

alter table public.profiles
  add column if not exists onboarding_completed_at timestamptz,
  add column if not exists username text,
  add column if not exists school_name text,
  add column if not exists study_goals text[] not null default '{}',
  add column if not exists referral_source text,
  add column if not exists onboarding_persona text;

create unique index if not exists profiles_username_lower_key
  on public.profiles (lower(username))
  where username is not null;

comment on column public.profiles.onboarding_persona is
  'Onboarding step 2: student | educator | professional | self_learner';

comment on column public.profiles.study_goals is
  'Onboarding step 3: slugs e.g. exam_prep, understand, ahead, skill, create_share, explore';

comment on column public.profiles.referral_source is
  'Onboarding step 7: friend | social | google | teacher | other';

-- Existing rows: treat as already onboarded so the gate only applies to new signups.
update public.profiles
set onboarding_completed_at = coalesce(onboarding_completed_at, created_at)
where onboarding_completed_at is null;

-- Username availability for the signed-in user (RLS hides other rows).
create or replace function public.profile_username_available(p_username text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null
    and length(trim(p_username)) >= 3
    and not exists (
      select 1
      from public.profiles p
      where p.username is not null
        and lower(trim(p.username)) = lower(trim(p_username))
        and p.id <> auth.uid()
    );
$$;

revoke all on function public.profile_username_available(text) from public;
grant execute on function public.profile_username_available(text) to authenticated;
