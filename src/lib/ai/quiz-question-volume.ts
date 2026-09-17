/**
 * Shared prompt rules so highlight / focus quiz generators pick how many
 * questions to write from distinct teachable ideas — no fixed count or cap.
 */

/** Prompt block for personal/focus quiz generators. */
export function quizQuestionVolumeRules(): string {
  return `QUESTION VOLUME (critical — judge what is important to understand):
Decide how many questions to write from the highlight alone. There is no fixed target count and no artificial maximum.
- Identify distinct teachable ideas worth remembering (definitions, mechanisms, contrasts, steps, relations, or examples that carry a separate point).
- Emit one question per important idea. Merge only when ideas are inseparable.
- A tiny one-definition / one-fact highlight can be just 1 question.
- A rich highlight can be many (8–10 or more) when the content warrants it.
- Prefer fewer high-quality questions over many overlapping ones. Do NOT pad. Do NOT invent filler facts.
ANTI-PATTERNS: Don't split one definition into near-duplicate stems. Don't pad to hit a count. Don't under-cover a dense multi-idea passage with a single vague question. Don't invent items to reach a preferred number.`;
}
