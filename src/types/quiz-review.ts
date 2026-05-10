/** Per bank question — aggregated from `question_attempts` for the module quiz review UI. */
export type QuizReviewStatsDto = {
  lastIsCorrect: boolean | null;
  lastAttemptAt: string | null;
  attemptCount: number;
  everCorrect: boolean;
  /** MCQ: 0–3 (display slot at attempt); FR: 4 wrong / 5 correct */
  lastSelectedChoice: number | null;
};
