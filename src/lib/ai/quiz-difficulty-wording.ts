/**
 * Shared prompt rules so quiz / focus-card wording complexity tracks
 * concept difficulty — easy items stay plain; hard items may be denser.
 */

export type QuizItemDifficulty = "easy" | "medium" | "hard";

/** Prompt block for quiz / focus-question generators. */
export function quizDifficultyWordingRules(): string {
  return `DIFFICULTY THEN WORDING (critical — do this for every item):
1) First judge the concept's true difficulty from the source (not how ornate you want to sound):
   - easy: definition, name, single fact, or obvious recall from the excerpt
   - medium: compare, apply, or connect two clear ideas
   - hard: multi-step reasoning, mechanism nuance, edge case, or precise technical discrimination
2) Set "difficulty" to "easy"|"medium"|"hard" on each item to match that judgment. Prefer easy when the concept is simple — do not inflate difficulty to sound smarter.
3) Match stem wording to that difficulty:
   - easy: short, direct, everyday words. One clause when possible. Ask the fact plainly ("What binds oxygen in blood?").
   - medium: clear and precise; one focused ask; light technical terms only when the source uses them.
   - hard: precise technical wording is OK when the concept warrants it; still prefer one clear question over nested clauses.
4) ANTI-PATTERNS (never do these on easy/medium items): nested "which of the following best describes…" theater; jargon-for-jargon's-sake; fake academic padding; long multi-clause stems for a one-fact recall. Do NOT apply one universal ornate style to every question.`;
}
