-- Allow recording free-response outcomes (use 4 = incorrect, 5 = correct; MCQ stays 0–3).

alter table public.question_attempts
  drop constraint if exists question_attempts_selected_choice_check;

alter table public.question_attempts
  add constraint question_attempts_selected_choice_check
  check (selected_choice >= 0 and selected_choice <= 10);
