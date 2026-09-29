-- Daily abuse cap for "generate more questions" / "focus questions":
--   extra_questions_daily — clicks today, across both tools
--
-- Reuses plan_meter_usage and its RPCs from migration 119 (apply 119 first).
-- The server passes the start of the current UTC day as period_start, so the
-- existing "newer period resets the counter" rule resets it every day.
-- The cap (60/day, env EXTRA_QUESTIONS_DAILY_CAP) lives in
-- src/lib/billing/plans.ts. Until this runs, the check constraint rejects the
-- new meter name and the app skips the daily cap (fails open).

alter table public.plan_meter_usage
  drop constraint if exists plan_meter_usage_meter_check;

alter table public.plan_meter_usage
  add constraint plan_meter_usage_meter_check
  check (meter in ('lecture_seconds', 'extra_questions', 'extra_questions_daily'));

comment on table public.plan_meter_usage is
  'Per-user plan meters (live lecture seconds, extra-question clicks per billing period and per UTC day). Server-only (service-role); caps in src/lib/billing/plans.ts.';
