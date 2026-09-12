-- Required audit trail for admin "view as user" (impersonation).
-- Server-only: written via the service-role key. RLS on, no policies — same
-- pattern as activity_events (047).

create table if not exists public.admin_impersonation_audit (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null,
  admin_email text,
  target_user_id uuid not null,
  target_email text not null,
  action text not null check (action in ('start', 'stop')),
  created_at timestamptz not null default now()
);

comment on table public.admin_impersonation_audit is
  'Who viewed the product as whom, and when. First-party admin support only.';

create index if not exists admin_impersonation_audit_created_at_idx
  on public.admin_impersonation_audit (created_at desc);
create index if not exists admin_impersonation_audit_admin_idx
  on public.admin_impersonation_audit (admin_user_id, created_at desc);
create index if not exists admin_impersonation_audit_target_idx
  on public.admin_impersonation_audit (target_user_id, created_at desc);

alter table public.admin_impersonation_audit enable row level security;
