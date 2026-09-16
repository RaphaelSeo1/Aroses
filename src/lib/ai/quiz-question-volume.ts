/**
 * Shared prompt rules so highlight / focus quiz generators pick how many
 * questions to write from distinct teachable units — not a fixed count.
 */

export const QUIZ_QUESTION_VOLUME_MIN = 1;
export const QUIZ_QUESTION_VOLUME_MAX = 6;

/** Clamp a client/default soft max into the allowed adaptive range. */
export function clampQuizQuestionSoftMax(count: number): number {
  if (!Number.isFinite(count)) return QUIZ_QUESTION_VOLUME_MAX;
  return Math.min(
    QUIZ_QUESTION_VOLUME_MAX,
    Math.max(QUIZ_QUESTION_VOLUME_MIN, Math.floor(count))
  );
}

/**
 * Prompt block for personal/focus quiz generators.
 * `softMax` is an upper bound — the model chooses 1..softMax from content.
 */
export function quizQuestionVolumeRules(softMax = QUIZ_QUESTION_VOLUME_MAX): string {
  const max = clampQuizQuestionSoftMax(softMax);
  return `QUESTION VOLUME (critical — judge distinct teachable units, not raw length alone):
Decide how many questions to write — between ${QUIZ_QUESTION_VOLUME_MIN} and ${max} inclusive. Prefer fewer high-quality questions over many overlapping ones. Do NOT pad to hit a count. Do NOT invent filler facts.
Signals:
- One term/definition, one formula, one short fact (≈1–2 sentences) → 1 question (rarely 2 if recognition + simple apply both matter)
- One short paragraph, 1–2 tightly related ideas → 1–2
- Medium highlight, several distinct facts/steps/relations → 2–4
- Long / multi-concept chunk (mechanisms, lists, compare/contrast) → 4–${max}, one per major concept — do not invent filler
- List of N independent items → cap thoughtfully (not always N); group trivial bullets
ANTI-PATTERNS: Don't split one definition into near-duplicate stems. Don't pad to hit a fixed count. Don't under-cover a dense multi-idea passage with a single vague question.`;
}
