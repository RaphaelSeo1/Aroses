/**
 * What a page is for, read from its structure alone: punctuation, layout,
 * casing and number patterns, never word lists, so every language is read
 * the same way.
 */
function letters(text: string): number {
  return (text.match(/\p{L}/gu) ?? []).length;
}

const QUESTION_END = /[?？؟]$/u;
/** "A. Mediator", "(b) Lamin", "가. …", "① …": one letter (or circled number) per choice. */
const CHOICE = /^(?:\(?(\p{L})[.)]|([\u2460-\u2473]))\s*\S/u;
/** "Q:", "Q1:", "問:": a short label that introduces a prompt. */
const PROMPT_LABEL = /^\p{L}{1,2}\d{0,2}\s*[:：]/u;
/** Declarative text a question page may carry (the setup, a label); more is teaching content. */
const QUESTION_PAGE_MAX_STATED = 200;

/** Lines joined where a sentence wraps, then split into sentences. */
function sentenceUnits(text: string): string[] {
  const merged: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const prev = merged[merged.length - 1];
    if (prev && !/[.!?。！？؟:;：]$/u.test(prev) && /^\p{Ll}/u.test(line) && !CHOICE.test(line)) {
      merged[merged.length - 1] = `${prev} ${line}`;
    } else merged.push(line);
  }
  return merged.flatMap((u) => (CHOICE.test(u) ? [u] : u.split(/(?<=[.!?。！？؟])\s+/u))).filter(Boolean);
}

/** At least two answer choices in a row: A, B … or ①, ② … */
function choiceRun(units: string[]): number {
  let best = 0;
  let run = 0;
  let prev = -1;
  for (const u of units) {
    const m = CHOICE.exec(u);
    const code = m ? (m[1] ?? m[2] ?? "").toLowerCase().codePointAt(0) ?? -1 : -1;
    run = m && (run === 0 || code === prev + 1) ? run + 1 : m ? 1 : 0;
    prev = code;
    best = Math.max(best, run);
  }
  return best;
}

/**
 * A page that only asks something: a clicker, poll or practice question
 * (question marks, answer-choice layout or a "Q:" label) with little stated
 * content beyond its setup. Its answer isn't on the page, so nothing may be
 * written as if it were.
 */
export function isQuestionPage(text: string): boolean {
  const units = sentenceUnits(text);
  if (units.length === 0) return false;
  let asked = 0;
  let stated = 0;
  for (const u of units) {
    const n = letters(u);
    if (CHOICE.test(u) || QUESTION_END.test(u)) asked += n;
    else if (!/[:：]$/u.test(u)) stated += n;
  }
  const choices = choiceRun(units) >= 2;
  const asks = asked > 0 || choices || PROMPT_LABEL.test(units[0]!);
  if (!asks) return false;
  return stated <= QUESTION_PAGE_MAX_STATED || (asked > 0 && stated <= asked);
}

const YEAR = /(?<![\p{N}])(?:1[5-9]\d\d|20\d\d)[a-z]?(?![\p{N}])/u;
const PAREN_YEAR = /\((?:[^()]{0,20}[\s,])?(?:1[5-9]\d\d|20\d\d)[a-z]?\)/u;
/** Volume and pages: "106:20788", "12 (3)", "251–260". */
const VOLUME_PAGES = /\d+\s*\(\d+\)|\d+\s*:\s*\d+|\d+\s*[–-]\s*\d+/u;
/** "Plaxton WC", "Smith, J. A.": a surname followed by initials. */
const AUTHOR = /\p{Lu}[\p{Ll}'’-]+,?\s(?:\p{Lu}\.\s?){1,3}|\p{Lu}[\p{Ll}'’-]+\s\p{Lu}{1,3}(?=[,.;:)\s]|$)/gu;
const MIN_CITATIONS = 5;
const MIN_CITATION_LINE_SHARE = 0.3;

/**
 * A reference list, bibliography or citation page: many entries, each with
 * a year (often in parentheses) next to volume and page numbers, and many
 * author names with initials.
 */
export function isReferencePage(text: string): boolean {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length >= 20);
  if (lines.length === 0) return false;
  const cites = lines.filter((l) => YEAR.test(l) && (PAREN_YEAR.test(l) || VOLUME_PAGES.test(l))).length;
  const authors = (text.match(AUTHOR) ?? []).length;
  return cites >= MIN_CITATIONS && authors >= MIN_CITATIONS && cites >= lines.length * MIN_CITATION_LINE_SHARE;
}

/** Symbol bullets and numbered items; lettered ones are answer choices and figure panels as often as lists. */
const BULLET = /^(?:[-•*▪◦·‣–]|\(?\d{1,2}[.)])\s+(.+)$/u;
const MAX_NAME_WORDS = 4;
const MAX_HEADING_CHARS = 40;
const MIN_ITEMS = 3;

function wordsOf(text: string): string[] {
  return text.split(/\s+/).filter((w) => /\p{L}/u.test(w));
}

/** Letters and digits only, lower case: "Non-competitive" and "noncompetitive" read alike. */
export function squash(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

/** The name a list item gives: the text before ":" or a dash, or a short item whole. */
function itemName(item: string): string | null {
  const t = item.replace(/[.;,]$/u, "").trim();
  const head = t.split(/\s*(?:[:：]|\s[–—-]\s)\s*/u)[0] ?? "";
  if (head !== t && wordsOf(head).length >= 1 && wordsOf(head).length <= MAX_NAME_WORDS) return head;
  return wordsOf(t).length >= 1 && wordsOf(t).length <= MAX_NAME_WORDS ? t : null;
}

/** Lines that only carry markup or navigation, like "[ edit ]". */
function isFiller(line: string): boolean {
  return /^\[[^\]]*\]$/u.test(line) || letters(line) === 0;
}

/**
 * Sets of named items a page lays out: bullet or numbered lists of short
 * names, and runs of short section headings each introducing a paragraph
 * that names it ("Competitive / In competitive inhibition …"). A lesson
 * that teaches the page should name every item.
 */
export function namedLists(text: string): string[][] {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !isFiller(l));
  const lists: string[][] = [];

  let run: string[] = [];
  const flush = () => {
    if (run.length >= MIN_ITEMS) lists.push(run);
    run = [];
  };
  for (const line of lines) {
    const m = BULLET.exec(line);
    const name = m ? itemName(m[1]!) : null;
    if (m && name) run.push(name);
    else if (!m) flush();
  }
  flush();

  const headings: string[] = [];
  lines.forEach((line, i) => {
    if (line.length > MAX_HEADING_CHARS || BULLET.test(line) || /[.!?:;,。！？؟]$/u.test(line) || /^\p{N}/u.test(line)) return;
    const words = wordsOf(line);
    if (words.length === 0 || words.length > MAX_NAME_WORDS || letters(line) < 3) return;
    const next = lines[i + 1];
    if (next == null) {
      if (headings.length > 0) headings.push(line);
      return;
    }
    if (wordsOf(next).length < 8) return;
    const key = squash(words.reduce((a, b) => (squash(b).length > squash(a).length ? b : a)));
    if (key.length >= 3 && squash(next.slice(0, 200)).includes(key)) headings.push(line);
  });
  if (headings.length >= MIN_ITEMS) lists.push(headings);
  return lists;
}

/** Scripts written without spaces between words, matched as a run of characters instead. */
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

/** Words squashed whole, so "Non-competitive" is one word and never matches "uncompetitive". */
function squashedWords(text: string): string[] {
  return text
    .replace(/(\p{L})[-‐‑](?=\p{L})/gu, "$1")
    .split(/\s+/)
    .map(squash)
    .filter(Boolean);
}

/**
 * Items of `items` that `written` never names. A word counts as named when a
 * written word starts with all of it but a short ending ("histones" is named
 * by "histone"); an item of several words needs half of them.
 */
export function missingItems(items: string[], written: string): string[] {
  const flat = squash(written);
  const have = squashedWords(written);
  const named = (w: string) => {
    const stem = w.slice(0, Math.max(Math.min(w.length, 4), w.length - 2));
    return have.some((h) => h.startsWith(stem));
  };
  return items.filter((item) => {
    if (UNSPACED.test(item) && flat.includes(squash(item))) return false;
    const words = squashedWords(item);
    return words.length === 0 || words.filter(named).length < Math.ceil(words.length / 2);
  });
}
