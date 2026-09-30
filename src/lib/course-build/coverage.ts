/**
 * Did the lessons teach every content page? Three signals per page: its
 * most characteristic words (frequent on the page, rare elsewhere), its
 * numbers, and the named items of any list it lays out. A page whose words
 * barely appear in the lessons, whose several numbers are all missing, or
 * whose list of N named items the lessons name fewer of, wasn't taught.
 * When the course is in another language only numbers and Latin acronyms
 * can be compared.
 */
import { matchTokens } from "./language.ts";
import { numberTokens } from "./numbers.ts";
import { missingItems, namedLists } from "./page-signals.ts";

export type CoveragePage = { g: number; text: string };

export type PageCoverage = {
  g: number;
  /** Share of the page's top words found in the lessons (1 when too few to judge). */
  words: number;
  /** Share of the page's numbers found (1 when it has fewer than two). */
  numbers: number;
  /** Named list items on the page that the lessons never name. */
  missingItems: string[];
  covered: boolean;
};

/** Characteristic words compared per page. */
const TOP_WORDS = 12;
const MIN_WORDS = 5;
const MIN_WORD_SHARE = 0.35;
/** A page with this many numbers, none of them taught, is missing unless its words clearly are there. */
const MIN_NUMBERS = 2;
const STRONG_WORD_SHARE = 0.6;

function numberKeys(text: string): string[] {
  return [
    ...new Set(
      numberTokens(text)
        .filter((t) => t.raw.replace(/\D/g, "").length >= 2)
        .map((t) => String(t.values[t.values.length - 1]))
    ),
  ];
}

function numberSet(text: string): Set<string> {
  const out = new Set<string>();
  for (const t of numberTokens(text)) for (const v of t.values) out.add(String(v));
  return out;
}

/** Acronyms, formulas and names in Latin letters survive translation (ATP, NADPH, RuBP, GAAP). */
function latinWords(text: string): string[] {
  return (text.match(/\b[A-Z][A-Za-z0-9]*[A-Z0-9][A-Za-z0-9]*\b/g) ?? []).map((w) => w.toLowerCase());
}

/** Links are never taught, so their fragments ("youtube", "watch", a video id) can't count against a page. */
function withoutLinks(text: string): string {
  return text.replace(/\b(?:https?:\/\/|www\.)\S+/giu, " ");
}

/** Lines of at least three words: sentences and bullets, not handwriting, labels or axis ticks. */
function isProse(line: string): boolean {
  return (line.match(/\p{L}{2,}/gu) ?? []).length >= 3;
}

function wordsOf(text: string, converting: boolean): string[] {
  if (converting) return latinWords(text);
  const lines = text.split("\n");
  // matchTokens dedupes; count repeats per line so frequent topic words rank first.
  const tokens = (from: string[]) => from.flatMap((line) => matchTokens(line));
  const prose = tokens(lines.filter(isProse));
  return new Set(prose).size >= TOP_WORDS ? prose : tokens(lines);
}

/**
 * Coverage of each page in `modulePages` by `written` (all lesson text of
 * the module). `allPages` decides which words are too common to count.
 */
export function pageCoverage(
  modulePages: CoveragePage[],
  allPages: CoveragePage[],
  written: string,
  converting = false
): PageCoverage[] {
  const df = new Map<string, number>();
  for (const p of allPages) for (const w of new Set(wordsOf(withoutLinks(p.text), converting))) df.set(w, (df.get(w) ?? 0) + 1);
  const common = Math.max(2, Math.ceil(allPages.length * 0.25));
  const haveWords = new Set(converting ? latinWords(written) : matchTokens(written));
  const haveNumbers = numberSet(written);

  return modulePages.map((page) => {
    const p = { ...page, text: withoutLinks(page.text) };
    const freq = new Map<string, number>();
    for (const w of wordsOf(p.text, converting)) freq.set(w, (freq.get(w) ?? 0) + 1);
    const top = [...freq.entries()]
      .filter(([w]) => (df.get(w) ?? 0) <= common)
      .sort((a, b) => b[1] - a[1] || (df.get(a[0]) ?? 0) - (df.get(b[0]) ?? 0) || b[0].length - a[0].length)
      .slice(0, TOP_WORDS)
      .map(([w]) => w);
    const nums = numberKeys(p.text);
    const words = top.length >= MIN_WORDS ? top.filter((w) => haveWords.has(w)).length / top.length : 1;
    const numbers = nums.length >= MIN_NUMBERS ? nums.filter((n) => haveNumbers.has(n)).length / nums.length : 1;
    const missing = converting ? [] : [...new Set(namedLists(p.text).flatMap((items) => missingItems(items, written)))];
    const covered = words >= MIN_WORD_SHARE && !(numbers === 0 && words < STRONG_WORD_SHARE) && missing.length === 0;
    return { g: p.g, words, numbers, missingItems: missing, covered };
  });
}
