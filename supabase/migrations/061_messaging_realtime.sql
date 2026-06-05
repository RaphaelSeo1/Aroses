-- Enable Supabase Realtime for instant message delivery in the UI.

alter table public.messages replica identity full;
alter table public.conversations replica identity full;

alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.conversations;
