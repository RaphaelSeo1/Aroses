-- Allow tutor sessions to enter a paused state after inactivity
-- (distinct from ended — student can resume from the library).

alter type public.tutor_session_status add value if not exists 'paused';
