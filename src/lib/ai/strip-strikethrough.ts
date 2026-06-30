/**
 * Remove "strikethrough self-correction" markup from generated lesson text.
 *
 * The model sometimes emits an error crossed out followed by its correction
 * (e.g. markdown `~~wrong~~ right`, HTML `<del>wrong</del>right`, or
 * `~~wrong~~ → right`). Rendered literally this shows the student a crossed-out
 * "mistake" plus the fix, which looks unprofessional. We want the FINAL text
 * only: delete the struck-out error and keep the surrounding correct text.
 *
 * Standalone + dependency-free on purpose so both the app (course-payload
 * normalization) and the one-off cleanup script can import the SAME logic
 * without pulling in path-aliased modules.
 *
 * Guarantees:
 * - Removes markdown `~~...~~` strikethrough segments (only paired `~~` on a
 *   single line; unrelated single `~` usage like "~5" is untouched).
 * - Removes HTML `<del>`, `<s>`, `<strike>` elements including inner text.
 * - Cleans up artifacts left behind by a removed strike: a trailing "→"/"->"
 *   correction arrow or a "(corrected: …)" parenthetical, doubled spaces, a
 *   space before punctuation, and stray leading/trailing whitespace.
 * - Idempotent and a no-op when there is no strikethrough (returns input
 *   unchanged), so normal markdown and tables are preserved.
 */

// Optional connector/annotation that directly follows a struck-out error and
// introduces its correction — removed together with the strike so we don't
// leave a dangling "→" or "(corrected: …)" behind.
const TRAILING_CORRECTION =
  String.raw`(?:\s*(?:→|->|—>|⇒|=>)\s*|\s*[([](?:corrected|correction|should\s+be|fix(?:ed)?|typo|sic)\b[^)\]]*[)\]])?`;

const MD_STRIKE_RE = new RegExp(
  String.raw`~~(?!~)[^~\n]+?~~` + TRAILING_CORRECTION,
  "g"
);

const HTML_STRIKE_RE = new RegExp(
  String.raw`<(del|s|strike)\b[^>]*>[\s\S]*?<\/\1>` + TRAILING_CORRECTION,
  "gi"
);

// Cheap pre-check: only do work when some strikethrough is actually present,
// guaranteeing the no-strikethrough path returns the input verbatim.
const HAS_MD_STRIKE = /~~(?!~)[^~\n]+?~~/;
const HAS_HTML_STRIKE = /<(?:del|s|strike)\b[^>]*>/i;

export function stripStrikethroughCorrections(text: string): string {
  if (typeof text !== "string" || text.length === 0) return text;
  if (!HAS_MD_STRIKE.test(text) && !HAS_HTML_STRIKE.test(text)) return text;

  let out = text.replace(HTML_STRIKE_RE, "").replace(MD_STRIKE_RE, "");
  if (out === text) return text;

  // Tidy up artifacts left where the struck-out text used to be. Kept narrow so
  // markdown tables, lists, and normal prose are preserved.
  out = out
    .replace(/[ \t]{2,}/g, " ") // collapse doubled spaces from removed inline text
    .replace(/[ \t]+([,.;:!?])/g, "$1") // drop a space before punctuation
    .replace(/[ \t]+\n/g, "\n") // trailing spaces on a line
    .trim();

  return out;
}
