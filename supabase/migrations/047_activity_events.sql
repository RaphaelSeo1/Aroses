-- Admin audit log: a real, append-only stream of platform activity.
--
-- Before this, the admin "Activity timeline" was *derived* from the `courses`
-- table and the Auth user list, so it could only ever show course-creations and
-- sign-ups. This table records everything else (logins, logouts, voice-tutor
-- sessions, module completions, quiz attempts, course builds/deletes, …) as it
-- happens.
--
-- Server-only: written exclusively via the service-role key (which bypasses
-- RLS). RLS is enabled with NO policies so anon/authenticated clients have zero
-- access — admins read it through the service-role admin client.

create table if not exists public.activity_events (
  id uuid primary key default gen_random_uuid(),
  -- Who did it. Nullable for system/anonymous events.
  user_id uuid,
  -- Event type, e.g. 'sign_in', 'sign_out', 'voice_tutor_started'. Free text so
  -- new event kinds can be added without a migration.
  type text not null,
  -- Optional short human context (course title, session topic, etc.).
  summary text,
  -- Structured extras (course_id, session_id, material_id, …).
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists activity_events_created_at_idx
  on public.activity_events (created_at desc);
create index if not exists activity_events_user_id_idx
  on public.activity_events (user_id);
create index if not exists activity_events_type_idx
  on public.activity_events (type);

alter table public.activity_events enable row level security;
