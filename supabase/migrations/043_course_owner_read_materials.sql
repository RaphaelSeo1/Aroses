-- Course creators can read every upload in their workspace courses,
-- even if a row's study_materials.user_id differs (e.g. legacy ingest).

drop policy if exists "Course owners read materials in own courses" on public.study_materials;

create policy "Course owners read materials in own courses"
  on public.study_materials
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.courses c
      where c.id = study_materials.course_id
        and c.user_id = auth.uid()
    )
  );
