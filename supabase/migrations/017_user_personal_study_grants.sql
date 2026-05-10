-- Tables from 016 need explicit privileges for the Supabase authenticated role
-- (RLS still applies). Without this, API inserts often fail with permission denied.

grant select, insert, update, delete on table public.user_lesson_notes to authenticated;
grant select, insert, update, delete on table public.user_personal_quiz_items to authenticated;
grant select, insert, update, delete on table public.user_personal_question_attempts to authenticated;
