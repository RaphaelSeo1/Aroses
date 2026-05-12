-- Super-admins: full CRUD on core course data as if they owned every row.
-- Use for the product owner only. After migrate:
--
--   insert into public.app_super_admins (user_id) values ('<your-auth-user-uuid>');
--
-- Gate the /dashboard/admin UI with the same UUID in env APP_ADMIN_USER_IDS
-- (optional NEXT_PUBLIC_APP_ADMIN_USER_IDS for the nav link).

create table if not exists public.app_super_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table public.app_super_admins is
  'Users who match is_app_super_admin() and receive owner-equivalent RLS on course data.';

alter table public.app_super_admins enable row level security;

drop policy if exists "app_super_admins_select_self" on public.app_super_admins;
create policy "app_super_admins_select_self"
  on public.app_super_admins for select
  to authenticated
  using (auth.uid() = user_id);

create or replace function public.is_app_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.app_super_admins a
    where a.user_id = (select auth.uid())
  );
$$;

comment on function public.is_app_super_admin() is
  'True when auth.uid() is listed in app_super_admins.';

grant execute on function public.is_app_super_admin() to authenticated;

-- courses
drop policy if exists "app_super_admins_all_courses" on public.courses;
create policy "app_super_admins_all_courses"
  on public.courses for all to authenticated
  using (public.is_app_super_admin())
  with check (public.is_app_super_admin());

-- exam_groups
drop policy if exists "app_super_admins_exam_groups_select" on public.exam_groups;
create policy "app_super_admins_exam_groups_select"
  on public.exam_groups for select to authenticated
  using (public.is_app_super_admin());

drop policy if exists "app_super_admins_exam_groups_insert" on public.exam_groups;
create policy "app_super_admins_exam_groups_insert"
  on public.exam_groups for insert to authenticated
  with check (public.is_app_super_admin());

drop policy if exists "app_super_admins_exam_groups_update" on public.exam_groups;
create policy "app_super_admins_exam_groups_update"
  on public.exam_groups for update to authenticated
  using (public.is_app_super_admin())
  with check (public.is_app_super_admin());

drop policy if exists "app_super_admins_exam_groups_delete" on public.exam_groups;
create policy "app_super_admins_exam_groups_delete"
  on public.exam_groups for delete to authenticated
  using (public.is_app_super_admin());

-- study_materials
drop policy if exists "app_super_admins_all_study_materials" on public.study_materials;
create policy "app_super_admins_all_study_materials"
  on public.study_materials for all to authenticated
  using (public.is_app_super_admin())
  with check (public.is_app_super_admin());

-- module_completion
drop policy if exists "app_super_admins_all_module_completion" on public.module_completion;
create policy "app_super_admins_all_module_completion"
  on public.module_completion for all to authenticated
  using (public.is_app_super_admin())
  with check (public.is_app_super_admin());

-- question_attempts
drop policy if exists "app_super_admins_all_question_attempts" on public.question_attempts;
create policy "app_super_admins_all_question_attempts"
  on public.question_attempts for all to authenticated
  using (public.is_app_super_admin())
  with check (public.is_app_super_admin());

-- pdf_ingest_jobs
drop policy if exists "app_super_admins_all_pdf_ingest_jobs" on public.pdf_ingest_jobs;
create policy "app_super_admins_all_pdf_ingest_jobs"
  on public.pdf_ingest_jobs for all to authenticated
  using (public.is_app_super_admin())
  with check (public.is_app_super_admin());

-- personal study (optional but keeps “full access” coherent)
drop policy if exists "app_super_admins_all_user_lesson_notes" on public.user_lesson_notes;
create policy "app_super_admins_all_user_lesson_notes"
  on public.user_lesson_notes for all to authenticated
  using (public.is_app_super_admin())
  with check (public.is_app_super_admin());

drop policy if exists "app_super_admins_all_user_personal_quiz_items" on public.user_personal_quiz_items;
create policy "app_super_admins_all_user_personal_quiz_items"
  on public.user_personal_quiz_items for all to authenticated
  using (public.is_app_super_admin())
  with check (public.is_app_super_admin());

drop policy if exists "app_super_admins_all_user_personal_question_attempts" on public.user_personal_question_attempts;
create policy "app_super_admins_all_user_personal_question_attempts"
  on public.user_personal_question_attempts for all to authenticated
  using (public.is_app_super_admin())
  with check (public.is_app_super_admin());
