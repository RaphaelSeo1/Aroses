-- Rich visual asset metadata + page snapshot fallback + mentored whiteboard state.

alter table public.course_assets
  add column if not exists title text,
  add column if not exists description text,
  add column if not exists labels_json jsonb not null default '[]'::jsonb,
  add column if not exists related_topics_json jsonb not null default '[]'::jsonb,
  add column if not exists teaching_purpose text,
  add column if not exists when_to_use text,
  add column if not exists surrounding_text text;

alter table public.course_assets drop constraint if exists course_assets_source_check;
alter table public.course_assets add constraint course_assets_source_check
  check (
    source in (
      'structural_raster',
      'structural_vector',
      'vision_bbox',
      'table_markdown',
      'page_snapshot'
    )
  );

comment on column public.course_assets.title is
  'Short vision-generated title for search and tutor reference.';
comment on column public.course_assets.description is
  'Detailed vision caption used for embeddings and lesson placement.';
comment on column public.course_assets.surrounding_text is
  'Nearby PDF text around the visual for retrieval context.';

alter table public.user_mentored_sessions
  add column if not exists tutor_mode text not null default 'presenting'
    check (tutor_mode in ('presenting', 'paused', 'answering', 'resuming')),
  add column if not exists whiteboard_state_json jsonb not null default '{}'::jsonb;

comment on column public.user_mentored_sessions.tutor_mode is
  'Live tutor phase: presenting a segment, paused on student request, answering a question, or resuming.';
comment on column public.user_mentored_sessions.whiteboard_state_json is
  'Serialized whiteboard overlays (highlights, arrows, labels) preserved across interruptions.';
