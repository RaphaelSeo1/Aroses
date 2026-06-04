-- Marketplace listings: sell courses (verification + attestation; payments later).

create table if not exists public.course_listings (
  course_id uuid primary key references public.courses (id) on delete cascade,
  seller_user_id uuid not null references auth.users (id) on delete cascade,
  price_cents integer not null check (price_cents >= 99 and price_cents <= 9999),
  currency text not null default 'usd' check (char_length(currency) = 3),
  status text not null default 'draft'
    check (status in ('draft', 'pending_review', 'approved', 'rejected')),
  attested_at timestamptz,
  attestation_version text,
  submitted_at timestamptz,
  quality_review jsonb,
  originality_review jsonb,
  requires_manual_review boolean not null default true,
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  rejection_reason text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists course_listings_status_submitted_idx
  on public.course_listings (status, submitted_at desc nulls last);

create index if not exists course_listings_seller_idx
  on public.course_listings (seller_user_id);

comment on table public.course_listings is
  'Per-course marketplace listing. Mutually exclusive with courses.is_public (free Explore).';

alter table public.course_listings enable row level security;

-- Anyone can read approved listing metadata (catalog).
create policy "Anyone can read approved course listings"
  on public.course_listings
  for select
  using (status = 'approved');

-- Sellers manage their own listing rows.
create policy "Sellers manage own course listings"
  on public.course_listings
  for all
  using (auth.uid() = seller_user_id)
  with check (auth.uid() = seller_user_id);

-- Super-admins (forum-style) full access when migration 025 applied.
do $$
begin
  if exists (
    select 1 from pg_proc where proname = 'is_app_super_admin'
  ) then
    execute $pol$
      create policy "app_super_admins_all_course_listings"
        on public.course_listings
        for all
        using (public.is_app_super_admin())
        with check (public.is_app_super_admin())
    $pol$;
  end if;
end $$;

-- Explore outline: free public OR approved marketplace listing (structure only).
create or replace function public.explore_course_outline(p_course_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when not exists (
      select 1
      from public.courses c
      where c.id = p_course_id
        and (
          c.is_public = true
          or exists (
            select 1
            from public.course_listings cl
            where cl.course_id = c.id
              and cl.status = 'approved'
          )
        )
    )
    then '[]'::jsonb
    else coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'examGroupName', eg.name,
            'examGroupSort', eg.sort_order,
            'fileName', sm.file_name,
            'materialSort', sm.sort_order,
            'modules', coalesce(
              (
                select jsonb_agg(
                  jsonb_build_object(
                    'id', coalesce((elem->>'id')::int, 0),
                    'title', coalesce(nullif(trim(elem->>'title'), ''), 'Untitled module')
                  )
                  order by idx
                )
                from jsonb_array_elements(
                  coalesce(sm.course_payload->'modules', '[]'::jsonb)
                ) with ordinality as t(elem, idx)
              ),
              '[]'::jsonb
            )
          )
          order by eg.sort_order, sm.sort_order
        )
        from public.study_materials sm
        join public.exam_groups eg on eg.id = sm.exam_group_id
        where sm.course_id = p_course_id
      ),
      '[]'::jsonb
    )
  end;
$$;

revoke all on function public.explore_course_outline(uuid) from public;
grant execute on function public.explore_course_outline(uuid) to anon;
grant execute on function public.explore_course_outline(uuid) to authenticated;
