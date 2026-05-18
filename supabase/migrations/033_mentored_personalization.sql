-- 033_mentored_personalization.sql
--
-- Adds the `personalization` column to `user_course_onboarding`. This
-- stores the AI-extracted, structured view of the student's free-text
-- onboarding answers that gets fed into Rose's system prompts so her
-- teaching adapts (skip basics they already know, lean into focus
-- areas, calibrate vocabulary to experience level).
--
-- Shape (after extraction):
--   {
--     knownTopics:   string[],   -- topics they said they're familiar with
--     focusAreas:    string[],   -- topics they want to focus on
--     experienceLevel: 'beginner' | 'intermediate' | 'advanced',
--     summary:       string      -- 1-sentence free-text summary for the
--                                --   prompt (capped at ~280 chars)
--   }
--
-- Defaulting to an empty object so existing rows don't need a backfill
-- — the runner lazily extracts on first turn when this is `{}`.

alter table public.user_course_onboarding
  add column if not exists personalization jsonb not null default '{}'::jsonb;

comment on column public.user_course_onboarding.personalization is
  'AI-extracted structured personalization derived from the goals/background free-text answers. See migration 033 header for shape.';
