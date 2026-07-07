-- Cost observability: per-call Claude usage ledger.
--
-- One append-only row per Anthropic call (feature, model, token counts, and
-- the user/job it was for) so per-user and per-feature cost is attributable.
-- Written only via the service-role client from the shared AI call wrappers;
-- reads restricted to app super admins.

create table if not exists public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid,
  job_id uuid,
  feature text not null,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0
);

create index if not exists ai_usage_events_user_idx
  on public.ai_usage_events (user_id, created_at desc);
create index if not exists ai_usage_events_created_at_idx
  on public.ai_usage_events (created_at desc);
create index if not exists ai_usage_events_feature_idx
  on public.ai_usage_events (feature);

alter table public.ai_usage_events enable row level security;

-- No insert/update/delete policies: only the service-role client writes.
drop policy if exists "ai_usage_events_super_admin_select" on public.ai_usage_events;
create policy "ai_usage_events_super_admin_select"
  on public.ai_usage_events for select
  using (public.is_app_super_admin());
