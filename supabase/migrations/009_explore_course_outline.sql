-- Public Explore: expose only structure (exam groups, PDF names, module titles) for
-- courses where is_public = true. Does not expose lesson text, summaries, or quizzes.

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
        and c.is_public = true
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
