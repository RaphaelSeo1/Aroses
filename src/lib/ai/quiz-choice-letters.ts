/**
 * The quiz UI renders its own A–D letters, so a model that writes
 * "A) Hemoglobin" would show "A. A) Hemoglobin". Strip the prefix only when
 * all four choices carry A, B, C, D in order, so real answers such as
 * "A. thaliana" are left alone.
 */

const LETTER_PREFIX = /^\s*\(?([A-Da-d])(?:\)|\.|:|\s-)\s*/;

function prefixLetter(choice: string): string | null {
  const m = choice.match(LETTER_PREFIX);
  return m ? m[1]!.toUpperCase() : null;
}

export function stripChoiceLetterPrefixes<T extends string[]>(choices: T): T {
  if (choices.length !== 4) return choices;
  const letters = choices.map(prefixLetter);
  if (letters.join("") !== "ABCD") return choices;
  return choices.map((c) => c.replace(LETTER_PREFIX, "")) as T;
}

/** Same prefix off a full-text `correct` ("B) Mitosis" → "Mitosis"). */
export function stripCorrectLetterPrefix(correct: string): string {
  const t = correct.trim();
  if (/^[ABCD]$/i.test(t)) return t;
  return t.replace(LETTER_PREFIX, "");
}
