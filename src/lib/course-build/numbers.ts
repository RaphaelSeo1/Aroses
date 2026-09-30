/**
 * Numbers in written lessons must come from the source: stated there, the
 * same figure rounded or rescaled (percent, thousands, millions, billions),
 * or a calculation shown in the same sentence from numbers the source states.
 * Anything else is invented.
 */

const EASTERN_DIGITS = /[\u0660-\u0669\u06f0-\u06f9]/g;

function westernDigits(text: string): string {
  return text.replace(EASTERN_DIGITS, (d) => String((d.charCodeAt(0) & 0xf) % 10));
}

/**
 * Numbers that make a claim. Digits after a Latin letter are part of a
 * formula or label (H2O, C3, T1) and ordinals (2nd) are wording; units and
 * attached words in other scripts ("10mg", "3개", "و7.45") still count.
 * Comma locants in chemical names ("fructose-1,6-bisphosphate") don't.
 */
const NUMBER = /(?<![A-Za-z\p{N}_.,/])\d+(?:[.,]\d+)*(?![\p{N}_]|(?:st|nd|rd|th)\b|,\d*-)/gu;
const LOCANT = /^\d+(?:,\d+)+$/;

export type NumberToken = { raw: string; values: number[]; decimals: number[] };

function decimalsOf(s: string): number {
  const i = s.search(/\.\d+$/);
  return i < 0 ? 0 : s.length - i - 1;
}

/** "1,234" may be 1234 or 1.234; "15.27" is 15.27; "1.234.567" is 1234567. */
function readings(raw: string): Array<{ value: number; decimals: number }> {
  const out: Array<{ value: number; decimals: number }> = [];
  const add = (s: string) => {
    const v = Number(s);
    if (Number.isFinite(v)) out.push({ value: v, decimals: decimalsOf(s) });
  };
  if (!/[.,]/.test(raw)) add(raw);
  else {
    const groups = raw.split(/[.,]/);
    const seps = raw.match(/[.,]/g) ?? [];
    if (groups.slice(1).every((g) => g.length === 3)) add(groups.join(""));
    if (seps.length === 1) add(raw.replace(",", "."));
    else if (new Set(seps).size === 2) {
      const last = raw.lastIndexOf(seps[seps.length - 1]!);
      add(raw.slice(0, last).replace(/[.,]/g, "") + "." + raw.slice(last + 1));
    }
  }
  return out;
}

export function numberTokens(text: string): NumberToken[] {
  const out: NumberToken[] = [];
  const plain = westernDigits(text);
  for (const m of plain.matchAll(NUMBER)) {
    if (LOCANT.test(m[0]) && /^[-‐′']/.test(plain.slice(m.index! + m[0].length))) continue;
    const r = readings(m[0]);
    if (r.length) out.push({ raw: m[0], values: r.map((x) => x.value), decimals: r.map((x) => x.decimals) });
  }
  return out;
}

/** Counts, steps and simple ordinals come from wording as often as from the source. */
function alwaysAllowed(v: number): boolean {
  return (Number.isInteger(v) && v >= 0 && v <= 10) || v === 100;
}

/** Percent, thousands, millions, billions. */
const SCALES = [100, 1000, 1e6, 1e9];

function decimalsOfValue(v: number): number {
  const s = String(v);
  if (/e/i.test(s)) return 12;
  const i = s.indexOf(".");
  return i < 0 ? 0 : s.length - i - 1;
}

/** Rows of a big table aren't a calculation the source sets up. */
const MAX_SENTENCE_NUMBERS = 4;

function oneStep(a: number, b: number): number[] {
  const out = [a + b, a - b, a * b];
  if (b !== 0) out.push(a / b, (a / b) * 100);
  return out.filter((v) => Number.isFinite(v) && v > 0);
}

export type NumberBacking = {
  /** Stated in the source, or the same figure rounded or rescaled. */
  backed(token: NumberToken): boolean;
};

export function numberBacking(sourceText: string): NumberBacking {
  const exact = new Set<number>();
  for (const t of numberTokens(sourceText)) for (const v of t.values) exact.add(v);
  const scaled = new Set<number>();
  for (const v of exact) {
    for (const f of SCALES) {
      scaled.add(Number((v * f).toPrecision(12)));
      scaled.add(Number((v / f).toPrecision(12)));
    }
  }
  // "the 420 number minus the 70": one step of arithmetic the source sets up in a sentence.
  const derived: number[] = [];
  for (const sentence of sentencesOf(sourceText)) {
    if ((sentence.match(/\p{L}{2,}/gu) ?? []).length < 3) continue;
    const vals = [...new Set(numberTokens(sentence).map((t) => t.values[t.values.length - 1]!))].filter((v) => !alwaysAllowed(v));
    if (vals.length > MAX_SENTENCE_NUMBERS) continue;
    for (const a of vals) for (const b of vals) if (a !== b) derived.push(...oneStep(a, b));
  }
  const all = [...exact, ...scaled];
  // "15.27 billion" for 15,265 million: a rounded figure matches a more precise source value.
  const rounds = (x: number, decimals: number) =>
    all.some((v) => decimalsOfValue(v) > decimals && Math.abs(v - x) <= 0.5 * 10 ** -decimals + 1e-9);
  return {
    backed(token) {
      // "10,000" also reads as the decimal 10.000; only a count written as one is always allowed.
      return token.values.some(
        (x, i) =>
          (alwaysAllowed(x) && !(token.decimals[i] ?? 0)) ||
          exact.has(x) ||
          scaled.has(x) ||
          rounds(x, token.decimals[i] ?? 0) ||
          derived.some((v) => Math.abs(v - x) <= 0.5 * 10 ** -(token.decimals[i] ?? 0) + 1e-9)
      );
    },
  };
}

function close(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(1e-9, Math.abs(b) * 0.005);
}

/** True when `x` is a sum, difference, product or ratio of two of `operands`. */
function computedFrom(x: number, operands: number[]): boolean {
  for (let i = 0; i < operands.length; i++) {
    for (let j = 0; j < operands.length; j++) {
      if (i === j) continue;
      const a = operands[i]!;
      const b = operands[j]!;
      if (close(x, a + b) || close(x, a - b) || close(x, a * b)) return true;
      if (b !== 0 && (close(x, a / b) || close(x, (a / b) * 100))) return true;
    }
  }
  return false;
}

/** Sentences, split only at sentence punctuation followed by a space (so 15.27 stays whole). */
export function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?。！？؟])\s+|\n+/u)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Numbers in one sentence that the source doesn't support. A result worked
 * out in the sentence itself ("25 × 40 = 1,000") counts when its operands do.
 */
export function unbackedInSentence(sentence: string, backing: NumberBacking, worked: Set<number> = new Set()): string[] {
  const tokens = numberTokens(sentence);
  const backedValues = tokens.filter((t) => backing.backed(t)).flatMap((t) => t.values);
  const bad: string[] = [];
  for (const t of tokens) {
    if (backing.backed(t)) continue;
    const computed = t.values.filter((x) => computedFrom(x, backedValues));
    if (computed.length) computed.forEach((x) => worked.add(x));
    else if (!t.values.some((x) => worked.has(x))) bad.push(t.raw);
  }
  return bad;
}

const LIST_ITEM = /^\s*(?:[-*•]|\d+[.)])\s+/;

/**
 * Removes sentences that state numbers the source doesn't support. Tables,
 * display math and figure markers are left as they are (source tables are
 * checked separately); a list item goes whole, a paragraph loses only the
 * offending sentence.
 */
export function stripUnbackedNumbers(text: string, backing: NumberBacking): { text: string; removed: string[] } {
  const removed: string[] = [];
  const worked = new Set<number>();
  let inMath = false;
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t.startsWith("$$")) {
      if (!(t.length > 2 && t.endsWith("$$") && t !== "$$")) inMath = !inMath;
      out.push(line);
      continue;
    }
    if (inMath || !t || t.startsWith("|") || t.startsWith("[figure") || t.startsWith("#")) {
      out.push(line);
      continue;
    }
    if (LIST_ITEM.test(line)) {
      const bad = unbackedInSentence(line, backing, worked);
      if (bad.length) removed.push(...bad);
      else out.push(line);
      continue;
    }
    const kept = sentencesOf(line).filter((s) => {
      const bad = unbackedInSentence(s, backing, worked);
      removed.push(...bad);
      return bad.length === 0;
    });
    if (kept.length) out.push(kept.join(" "));
  }
  return { text: out.join("\n").replace(/\n{3,}/g, "\n\n").trim(), removed };
}

/**
 * Numbers in `text` that the source doesn't state or directly support. A
 * result worked out in an earlier sentence may be repeated later.
 */
export function unbackedNumbers(text: string, backing: NumberBacking): string[] {
  const worked = new Set<number>();
  return sentencesOf(text).flatMap((s) => unbackedInSentence(s, backing, worked));
}
