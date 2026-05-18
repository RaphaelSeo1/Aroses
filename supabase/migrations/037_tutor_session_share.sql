-- 037_tutor_session_share.sql
--
-- Adds public read-only share-link support to tutor session recaps.
--
-- Students can flip "Share" on the recap view to generate a short
-- random token. Anyone with the URL can read the recap in a stripped
-- public viewer (no auth required). Re-clicking Share rotates the
-- token (old links stop working). Clicking again to disable nulls
-- it out entirely.
--
-- Only the recap is shared — never the transcript, uploads, or live
-- notes. The viewer renders title + metadata + recap_markdown only.

alter table public.tutor_sessions
  add column if not exists share_token text;

create unique index if not exists tutor_sessions_share_token_idx
  on public.tutor_sessions (share_token)
  where share_token is not null;

-- Anyone (including anon) can SELECT a row when the share_token in
-- the request matches. Implemented as a function the share API
-- calls — we don't expand the RLS policy itself because matching
-- on a request-supplied token would require URL parsing in SQL.
-- The /api/share/tutor-session/[token] route looks up the row via
-- the service-role client and returns only the public-safe fields.

comment on column public.tutor_sessions.share_token is
  'When non-NULL, this recap is publicly readable via /share/session/[token]. Rotated on toggle, nulled on disable. NEVER includes transcript/uploads.';
