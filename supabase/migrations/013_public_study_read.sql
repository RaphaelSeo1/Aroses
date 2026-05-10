-- Allow anonymous and logged-in learners to read study materials and exam groups
-- for courses listed on Explore (is_public = true). Owners retain full CRUD via existing policies.

create policy "Anyone can read study materials for public courses"
  on public.study_materials for select
  using (
    exists (
      select 1 from public.courses c
      where c.id = study_materials.course_id and c.is_public = true
    )
  );

create policy "Anyone can read exam groups for public courses"
  on public.exam_groups for select
  using (
    exists (
      select 1 from public.courses c
      where c.id = exam_groups.course_id and c.is_public = true
    )
  );
