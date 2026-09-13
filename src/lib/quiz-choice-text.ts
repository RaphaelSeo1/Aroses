/**
 * Models often emit "C) The member is responsible…". The review UI already
 * paints A–D on the left, so those prefixes double-label the choice.
 */
const LETTER_PREFIX_RE = /^\s*[A-Da-d](?:[)\]:.]|\s*[-–—])\s+/;

export function stripChoiceLetterPrefix(text: string): string {
  let s = text.trim();
  for (let i = 0; i < 3; i += 1) {
    const next = s.replace(LETTER_PREFIX_RE, "").trim();
    if (next === s || !next) break;
    s = next;
  }
  return s;
}

export function stripChoiceLetterPrefixes(
  choices: readonly string[]
): string[] {
  return choices.map((c) => stripChoiceLetterPrefix(c));
}
