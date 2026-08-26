-- Track how far draft-from-deck note seeding has progressed so a reload
-- does not re-append the same slides.

alter table public.live_lecture_sessions
  add column if not exists slides_seeded_through_page integer not null default 0;

comment on column public.live_lecture_sessions.slides_seeded_through_page is
  'Highest slide/page number already drafted into live notes from the uploaded deck.';
