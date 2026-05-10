-- Run after 004_exam_groups.sql.
-- Ensures authenticated clients can read/write their rows (fixes common RLS/grant issues).

grant usage on schema public to authenticated;
grant select, insert, update, delete on table public.exam_groups to authenticated;

-- Replace broad FOR ALL policy with explicit per-command policies (avoids edge cases).
drop policy if exists "Users manage own exam groups" on public.exam_groups;
drop policy if exists "exam_groups_select_own" on public.exam_groups;
drop policy if exists "exam_groups_insert_own" on public.exam_groups;
drop policy if exists "exam_groups_update_own" on public.exam_groups;
drop policy if exists "exam_groups_delete_own" on public.exam_groups;

create policy "exam_groups_select_own"
  on public.exam_groups for select
  using (auth.uid() = user_id);

create policy "exam_groups_insert_own"
  on public.exam_groups for insert
  with check (auth.uid() = user_id);

create policy "exam_groups_update_own"
  on public.exam_groups for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "exam_groups_delete_own"
  on public.exam_groups for delete
  using (auth.uid() = user_id);
