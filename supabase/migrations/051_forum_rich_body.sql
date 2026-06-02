-- Rich text for forum posts.
--
-- Posts now support formatted bodies (bold/italic/underline/strike, highlight,
-- links, lists, and inline images) authored in the same TipTap editor used for
-- notes. The formatted document is stored as TipTap JSON in `body_rich`.
--
-- The existing `body` column is kept as a plain-text mirror of `body_rich` so
-- search, list previews, and any legacy plain-text posts keep working without a
-- migration of historical rows. New posts populate both columns; old posts keep
-- rendering from `body`.

alter table public.forum_posts
  add column if not exists body_rich jsonb;

comment on column public.forum_posts.body_rich is
  'TipTap JSON for the formatted post body. `body` holds the plain-text mirror used for search/previews and legacy posts.';
