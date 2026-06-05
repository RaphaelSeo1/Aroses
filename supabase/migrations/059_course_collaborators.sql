-- Course collaboration: shared content, per-user progress, role-based access.

-- ── Collaborators table ─────────────────────────────────────────────────────

create table if not exists public.course_collaborators (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  user_id uuid references auth.users (id) on delete cascade,
  invited_email text,
  role text not null check (role in ('owner', 'editor', 'viewer')),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'revoked')),
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  accepted_at timestamptz,
  constraint course_collaborators_user_or_email_chk check (
    user_id is not null or (invited_email is not null and char_length(trim(invited_email)) > 0)
  )
);

create unique index if not exists course_collaborators_course_user_uidx
  on public.course_collaborators (course_id, user_id)
  where user_id is not null;

create unique index if not exists course_collaborators_pending_email_uidx
  on public.course_collaborators (course_id, lower(trim(invited_email)))
  where status = 'pending' and invited_email is not null;

create index if not exists course_collaborators_user_status_idx
  on public.course_collaborators (user_id, status)
  where user_id is not null;

create index if not exists course_collaborators_course_idx
  on public.course_collaborators (course_id, status);

comment on table public.course_collaborators is
  'Per-course collaboration: owner/editor/viewer roles with invite lifecycle.';

-- Backfill: one accepted owner row per existing course.
insert into public.course_collaborators (
  course_id,
  user_id,
  role,
  status,
  invited_by,
  accepted_at,
  created_at,
  updated_at
)
select
  c.id,
  c.user_id,
  'owner',
  'accepted',
  c.user_id,
  c.created_at,
  c.created_at,
  now()
from public.courses c
where not exists (
  select 1
  from public.course_collaborators cc
  where cc.course_id = c.id
    and cc.user_id = c.user_id
    and cc.role = 'owner'
);

-- ── Content edit attribution ────────────────────────────────────────────────

alter table public.study_materials
  add column if not exists last_edited_by uuid references auth.users (id) on delete set null,
  add column if not exists last_edited_at timestamptz;

-- ── Permission helpers (security definer for RLS) ─────────────────────────────

create or replace function public.collaborator_role_for_course(
  p_course_id uuid,
  p_user_id uuid default auth.uid()
)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select cc.role
  from public.course_collaborators cc
  where cc.course_id = p_course_id
    and cc.user_id = p_user_id
    and cc.status = 'accepted'
  limit 1;
$$;

create or replace function public.is_accepted_course_collaborator(
  p_course_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.course_collaborators cc
    where cc.course_id = p_course_id
      and cc.user_id = p_user_id
      and cc.status = 'accepted'
  );
$$;

create or replace function public.can_view_course_content(
  p_course_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.courses c
    where c.id = p_course_id and c.user_id = p_user_id
  )
  or public.is_accepted_course_collaborator(p_course_id, p_user_id);
$$;

create or replace function public.can_edit_course_content(
  p_course_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.courses c
    where c.id = p_course_id and c.user_id = p_user_id
  )
  or exists (
    select 1
    from public.course_collaborators cc
    where cc.course_id = p_course_id
      and cc.user_id = p_user_id
      and cc.status = 'accepted'
      and cc.role in ('owner', 'editor')
  );
$$;

create or replace function public.is_course_owner(
  p_course_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.courses c
    where c.id = p_course_id and c.user_id = p_user_id
  );
$$;

revoke all on function public.collaborator_role_for_course(uuid, uuid) from public;
grant execute on function public.collaborator_role_for_course(uuid, uuid) to authenticated;

revoke all on function public.is_accepted_course_collaborator(uuid, uuid) from public;
grant execute on function public.is_accepted_course_collaborator(uuid, uuid) to authenticated;

revoke all on function public.can_view_course_content(uuid, uuid) from public;
grant execute on function public.can_view_course_content(uuid, uuid) to authenticated;

revoke all on function public.can_edit_course_content(uuid, uuid) from public;
grant execute on function public.can_edit_course_content(uuid, uuid) to authenticated;

revoke all on function public.is_course_owner(uuid, uuid) from public;
grant execute on function public.is_course_owner(uuid, uuid) to authenticated;

-- ── RLS: course_collaborators ───────────────────────────────────────────────

alter table public.course_collaborators enable row level security;

create policy "Users read own collaborator rows"
  on public.course_collaborators
  for select
  to authenticated
  using (user_id = auth.uid());

create policy "Owners manage course collaborators"
  on public.course_collaborators
  for all
  to authenticated
  using (public.is_course_owner(course_id))
  with check (public.is_course_owner(course_id));

create policy "Accepted collaborators read team roster"
  on public.course_collaborators
  for select
  to authenticated
  using (
    public.is_accepted_course_collaborator(course_id)
  );

create policy "Invitees accept or decline own invites"
  on public.course_collaborators
  for update
  to authenticated
  using (user_id = auth.uid() and status in ('pending', 'accepted'))
  with check (user_id = auth.uid());

create policy "Non-owners may leave accepted collaboration"
  on public.course_collaborators
  for update
  to authenticated
  using (
    user_id = auth.uid()
    and status = 'accepted'
    and role <> 'owner'
  )
  with check (
    user_id = auth.uid()
    and status = 'revoked'
  );

do $$
begin
  if exists (select 1 from pg_proc where proname = 'is_app_super_admin') then
    execute $pol$
      create policy "app_super_admins_all_course_collaborators"
        on public.course_collaborators
        for all
        using (public.is_app_super_admin())
        with check (public.is_app_super_admin())
    $pol$;
  end if;
end $$;

-- ── RLS: courses — collaborators can read shared workspaces ───────────────

create policy "Accepted collaborators read shared courses"
  on public.courses
  for select
  to authenticated
  using (public.is_accepted_course_collaborator(id));

-- ── RLS: exam_groups — collaborators read; editors write ────────────────────

create policy "Collaborators read exam groups"
  on public.exam_groups
  for select
  to authenticated
  using (public.can_view_course_content(course_id));

create policy "Editors manage exam groups in shared courses"
  on public.exam_groups
  for insert
  to authenticated
  with check (public.can_edit_course_content(course_id));

create policy "Editors update exam groups in shared courses"
  on public.exam_groups
  for update
  to authenticated
  using (public.can_edit_course_content(course_id))
  with check (public.can_edit_course_content(course_id));

create policy "Editors delete exam groups in shared courses"
  on public.exam_groups
  for delete
  to authenticated
  using (public.can_edit_course_content(course_id));

-- ── RLS: study_materials — collaborators read; editors write ─────────────────

create policy "Collaborators read study materials"
  on public.study_materials
  for select
  to authenticated
  using (public.can_view_course_content(course_id));

create policy "Editors insert study materials in shared courses"
  on public.study_materials
  for insert
  to authenticated
  with check (public.can_edit_course_content(course_id));

create policy "Editors update study materials in shared courses"
  on public.study_materials
  for update
  to authenticated
  using (public.can_edit_course_content(course_id))
  with check (public.can_edit_course_content(course_id));

create policy "Editors delete study materials in shared courses"
  on public.study_materials
  for delete
  to authenticated
  using (public.can_edit_course_content(course_id));

grant select, insert, update, delete on public.course_collaborators to authenticated;
