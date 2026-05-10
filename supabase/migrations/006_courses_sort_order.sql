-- Manual ordering on the dashboard (move up / down).

alter table public.courses add column if not exists sort_order int not null default 0;

with ranked as (
  select
    id,
    row_number() over (
      partition by user_id
      order by created_at asc
    ) - 1 as ord
  from public.courses
)
update public.courses c
set sort_order = ranked.ord
from ranked
where c.id = ranked.id;

create index if not exists courses_user_sort_idx
  on public.courses (user_id, sort_order);
