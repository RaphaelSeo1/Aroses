/**
 * Source coverage ledger — deterministic, no model call.
 *
 * Coverage is checked per CONTRIBUTION (a sentence-level piece of
 * instructional information a source unit introduces), never per topic:
 * a note section about the same concept does not cover a slide that adds a
 * mechanism, stage, number, exception, or comparison about that concept.
 *
 *   buildSourceCoverageLedger(units)  → contributions per unit, in source
 *                                       order, with source-internal repeats
 *                                       marked (introduced elsewhere)
 *   auditSourceCoverage(ledger, notes) → every substantive unit is exactly
 *                                       COVERED | REDUNDANT | NON-SUBSTANTIVE
 *                                       | VISUAL-ONLY | MISSING, plus
 *                                       contiguous missing ranges
 *   repairSourceCoverage(...)          → inserts ONLY the missing delta, in
 *                                       source wording, into the best
 *                                       existing AI section (or a new one),
 *                                       then re-audits until nothing is missing
 *
 * Visual-only units (diagram labels, no sentences, or an extraction
 * placeholder) are reported, never silently marked covered — text extraction
 * cannot verify them.
 */

import {
  dedupeSectionLines,
  extractNoteHeading,
  normalizeLine,
  normalizeNoteHeading,
  numberTokens,
  placeIncomingNoteLines,
  tokenizeNoteText,
} from "@/lib/live-notes/fold-note-markdown";
import type { SourceUnit, UnrepresentedRange } from "@/lib/notes/source-coverage";
import { normalizeSourceText, segmentSourceText } from "@/lib/notes/source-text";

export type { SourceUnit } from "@/lib/notes/source-coverage";

// ── Contributions ──────────────────────────────────────────────────────────

export type SourceContribution = {
  /** `${unitId}#${index}` */
  id: string;
  unitId: string;
  /** Unit document order. */
  order: number;
  /** Source wording (normalized typography only). */
  text: string;
  /** Distinct content tokens (stemmed). */
  tokens: string[];
  /** Number(+unit) tokens that must be present for the contribution to count as covered. */
  numbers: string[];
  /** Capitalized / named terms (lowercased stems) — weighted double. */
  terms: string[];
  kind: "sentence" | "label";
  /** False when an earlier unit already carries this information. */
  introducedHere: boolean;
  /** Unit id that first introduced this information (self when introducedHere). */
  introducedBy: string;
};

export type LedgerUnitKind = "substantive" | "non-substantive" | "visual-only";

export type SourceLedgerUnit = {
  unit: SourceUnit;
  kind: LedgerUnitKind;
  contributions: SourceContribution[];
  /** Diagram/label fragments (not audited individually). */
  labels: string[];
};

export type SourceCoverageLedger = {
  units: SourceLedgerUnit[];
  contributions: SourceContribution[];
};

/** Filler that never carries a fact on its own (on top of the tokenizer stop list). */
const FILLER = new Set([
  "also", "then", "than", "essentially", "basically", "simply", "really",
  "very", "quite", "often", "usually", "generally", "typically", "however",
  "therefore", "thus", "hence", "meaning", "means", "refers", "called",
  "known", "which", "where", "while", "because", "into", "onto", "each",
  "every", "both", "either", "well", "way", "like", "such", "other",
  "another", "same", "recall", "again", "here", "there", "about", "its",
  "their", "them", "they", "are", "was", "were", "been", "being", "can",
  "could", "will", "would", "should", "may", "might", "must", "does", "did",
  "done", "get", "got", "use", "used", "using", "via", "per", "still", "yet",
  "already", "only", "even", "much", "many", "most", "less", "few", "thing",
  "things", "kind", "sort", "something", "from", "between", "among",
  "within", "across", "along", "around", "toward", "towards", "upon",
  "whether", "though", "although", "whereas", "these", "those", "into",
  "over", "under", "through", "during", "until", "after", "before", "note",
  "notes", "see", "e.g", "i.e", "etc", "let", "lets", "one", "two", "three",
  "first", "second", "third", "next", "last", "new", "case", "cases",
  "process", "role", "roles", "important", "key", "main", "example",
  "examples", "following", "shown", "show", "shows", "figure", "above",
  "below", "left", "right", "time", "times",
]);

/** Administrative / outline units: not teaching content unless a hard fact is on them. */
const AGENDA_RE =
  /\b(agenda|today we will|today's agenda|logistics|announcements?|attendance|welcome(?: to)?(?: the)?(?: course)?|questions from last time|looking ahead|learning objectives|objectives|outline|overview of (?:today|the lecture)|housekeeping|office hours|homework due|reading assignment)\b/i;
/** A hard fact that makes an agenda-looking unit worth covering anyway. */
const HARD_FACT_CUE_RE =
  /\b(define[ds]? as|definition|equation|formula|theorem|proof|\d+\s*(?:%|percent|mg|ml|kg|km|ms|nm|µm|hz|kb|mb))\b|=/i;
const VISUAL_PLACEHOLDER_RE = /^\(?slide \d+ — little selectable text; mostly visual\.?\)?$/i;
const NOISE_RE =
  /^(?:https?:\/\/\S+|www\.\S+|@\w+|questions\??|any questions\??|thank you\.?|thanks\.?|end|the end|fin|slide \d+|page \d+|\d+|[^a-z0-9]+)$/i;
const CITATION_NOISE_RE = /\bdoi:\S+|https?:\/\/\S+|www\.\S+|\b\d+:\d+[-–]\d+\b/gi;
/**
 * Course / lecture header lines ("BIOL 101 — Lecture 4: Membranes",
 * "Dr. R. Okafor", "Reading: Chapter 7", "Week 3, Session 2"): identification,
 * not teaching content.
 */
const HEADER_LINE_RE =
  /^(?:[A-Z]{2,6}\s?\d{1,4}[A-Z]?\s*(?:[—–:|-]\s*|(?:lecture|week|session)\b)[^.]{0,80}$|(?:lecture|week|session|module|chapter)\s+\d+\b[^.]{0,60}$|(?:dr|prof|professor|instructor|lecturer|ta|teaching assistant)\.?\s+\p{Lu}[^.]{0,40}$|(?:reading|readings|textbook|homework|assignment|due|office hours?|slides? by|prepared by|presented by)\b[^.]{0,60}$)/iu;
const HEADER_VERB_RE = /\b(?:is|are|was|were|has|have|had|can|will|does|do|did|means|causes?|shows?)\b/i;
/**
 * "Hirano and Mitchison, 1994", "Hassold & Hunt (2001)", "József Gelei, 1922",
 * "et al. Science 2018;359:…" — attribution, not a fact of its own.
 */
const CITATION_RE =
  /(?:\b\p{Lu}[\p{L}’'-]+(?:,? (?:and|&) \p{Lu}[\p{L}’'-]+)+,? \(?(?:19|20)\d{2}\)?|^\p{Lu}[\p{L}’'-]+(?: \p{Lu}[\p{L}’'-]+){0,3},? \(?(?:19|20)\d{2}\)?\.?$|\bet al\.?|\b(?:Nature|Science|Cell|Journal|Proc|Proceedings|Reviews|Genetics|Lancet|PNAS|eLife|Annu|Rev|vol\.?|pp\.?)\b.*\b(?:19|20)\d{2}\b|\b(?:19|20)\d{2}\b[;:]\d+)/u;
/** Exponent digit split from its unit by extraction ("cm 3" for cm³). */
const EXPONENT_RE = /\b(cm|mm|km|nm|µm|um|m|ft|in|dm)\s+([23])\b/gi;
const NUMBER_WORDS: Record<string, string> = {
  zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6",
  seven: "7", eight: "8", nine: "9", ten: "10", eleven: "11", twelve: "12",
  twenty: "20", thirty: "30", forty: "40", fifty: "50", hundred: "100",
  thousand: "1000",
};
const NUMBER_WORD_RE = new RegExp(`\\b(${Object.keys(NUMBER_WORDS).join("|")})\\b`, "gi");

/** Spelled-out small numbers become digits so "three copies" matches "3 copies". */
function digitizeNumberWords(norm: string): string {
  return norm.replace(NUMBER_WORD_RE, (m) => NUMBER_WORDS[m.toLowerCase()] ?? m);
}

function wordRoot(t: string): string {
  return t.length > 5 ? t.replace(/(?:ing|ed|es|ly|s|e)$/, "") : t;
}

function sharesRoot(a: string, b: string): boolean {
  if (a === b) return true;
  const ra = wordRoot(a);
  const rb = wordRoot(b);
  if (ra === rb) return true;
  const [s, l] = ra.length <= rb.length ? [ra, rb] : [rb, ra];
  return s.length >= 4 && l.startsWith(s) && l.length - s.length <= 4;
}

function contentTokens(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of tokenizeNoteText(text)) {
    if (FILLER.has(t) || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function capitalizedTerms(text: string): string[] {
  const words = text.split(/\s+/);
  const out = new Set<string>();
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!.replace(/^[("'“‘]+|[)"'”’.,;:!?]+$/g, "");
    // Mid-sentence capitalized words, acronyms, and mixed-case gene-style names.
    if (i > 0 && /^[A-Z][A-Za-z0-9-]{2,}$/.test(w)) {
      for (const t of tokenizeNoteText(w)) out.add(t);
    } else if (/^[A-Z]{2,}[A-Za-z0-9-]*$/.test(w) || /^[A-Za-z]+\d+[A-Za-z]*$/.test(w)) {
      for (const t of tokenizeNoteText(w)) out.add(t);
    }
  }
  return [...out];
}

function contributionNumbers(text: string): string[] {
  const cleaned = text.replace(CITATION_NOISE_RE, " ").replace(EXPONENT_RE, "$1");
  return [...new Set(numberTokens(digitizeNumberWords(normalizeLine(cleaned))))];
}

function isNoiseSegment(seg: string): boolean {
  const t = seg.trim();
  if (!t) return true;
  if (NOISE_RE.test(t)) return true;
  if (/^(?:see|source|from|credit|image|photo|courtesy)\s*:?\s*https?:/i.test(t)) return true;
  if (HEADER_LINE_RE.test(t) && t.split(/\s+/).length <= 8 && !HEADER_VERB_RE.test(t)) return true;
  return false;
}

/** Bibliographic reference — attribution travels with the previous fact, never audited alone. */
function isCitationSegment(seg: string): boolean {
  if (!CITATION_RE.test(seg)) return false;
  const words = seg.split(/\s+/).length;
  return words <= 16;
}

/**
 * Diagram / figure labels: starts with a symbol, most words carry digits,
 * "::", "/", or symbols, or the same few tokens repeat across many words
 * ("condensin I condensin II I / II DNA DNA / I / II").
 */
function looksLikeFigureLabel(seg: string, tokens: string[]): boolean {
  const words = seg.split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  if (/^[^A-Za-z0-9“"'(]/.test(seg)) return true;
  // Construct / magnification labels ("mCherry::histone", "50X real time").
  if (/::|\b\d+x\b/i.test(seg)) return true;
  const nonWord = words.filter((w) => !/^[A-Za-z][A-Za-z'’-]*[.,;:!?)]*$/.test(w)).length;
  if (nonWord / words.length >= 0.5) return true;
  if (words.length >= 6 && tokens.length / words.length < 0.35) return true;
  return false;
}

/** Strip URLs / handles / DOIs before tokenizing so they never count as information. */
function informationalText(text: string): string {
  return text.replace(CITATION_NOISE_RE, " ").replace(/@\w+/g, " ");
}

function classifyContribution(
  text: string
): { kind: "sentence" | "label"; tokens: string[]; numbers: string[]; terms: string[] } {
  const info = informationalText(text);
  const tokens = contentTokens(info);
  const numbers = contributionNumbers(text);
  const terms = capitalizedTerms(info).filter((t) => tokens.includes(t));
  const wordCount = info.split(/\s+/).filter(Boolean).length;
  // Construct / magnification labels are figure captions even with digits
  // ("50X real time mCherry::histone ZYG-12::GFP").
  if (/::/.test(info) || (/\b\d+x\b/i.test(info) && wordCount <= 6)) {
    return { kind: "label", tokens, numbers, terms };
  }
  if (looksLikeFigureLabel(info.trim(), tokens)) {
    // Symbol-heavy segments that still carry facts are audited as data:
    // table rows ("Singapore | Af | 26 | 28 | 2,340"), equations
    // ("ΔG = ΔH − TΔS"), labelled values ("Water: c = 4.184 J/(g·°C)").
    const tableRow = info.split(" | ").length >= 3;
    const equation = /[=→⇌≈]/.test(info);
    const data =
      (numbers.length > 0 && tokens.length >= (tableRow ? 1 : 2)) ||
      (equation && tokens.length >= 2) ||
      (tableRow && tokens.length >= 3);
    if (!data) return { kind: "label", tokens, numbers, terms };
    return { kind: "sentence", tokens, numbers, terms };
  }
  const sentence =
    (wordCount >= 5 && tokens.length >= 3) ||
    (wordCount >= 3 && tokens.length >= 2 && numbers.length > 0) ||
    tokens.length >= 6;
  return { kind: sentence ? "sentence" : "label", tokens, numbers, terms };
}

type Weighted = { tokens: string[]; terms: Set<string>; numbers: string[] };

/**
 * Share of `c`'s information present in a token window. Named terms weigh
 * double; numbers (with units) are mandatory and checked separately.
 */
function informationScore(
  c: Weighted,
  windowTokens: Set<string>,
  windowList: string[],
  windowNumbers: Set<string>
): { score: number; numbersOk: boolean } {
  let total = 0;
  let hit = 0;
  for (const t of c.tokens) {
    const w = c.terms.has(t) ? 2 : 1;
    total += w;
    if (windowTokens.has(t) || windowList.some((n) => sharesRoot(n, t))) hit += w;
  }
  const numbersOk = c.numbers.every((n) => windowNumbers.has(n) || windowNumbers.has(n.split(" ")[0]!));
  return { score: total === 0 ? 1 : hit / total, numbersOk };
}

/** Minimum information share for a contribution to count as covered. */
export const COVERED_MIN_SCORE = 0.6;
/** Near-equivalence: a later source unit merely repeats an earlier one. */
const REDUNDANT_MIN_SCORE = 0.8;

export function buildSourceCoverageLedger(units: SourceUnit[]): SourceCoverageLedger {
  const sorted = [...units].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const ledgerUnits: SourceLedgerUnit[] = [];
  const all: SourceContribution[] = [];
  // Earlier contributions (weighted) for source-internal repeat detection.
  const earlier: Array<{ c: SourceContribution; w: Weighted; set: Set<string>; nums: Set<string> }> = [];

  for (const unit of sorted) {
    const text = normalizeSourceText(unit.text);
    const label = normalizeSourceText(unit.label ?? "").trim();
    const blob = `${label} ${text}`;
    const segments = segmentSourceText(text).filter((s) => !isNoiseSegment(s));
    const contributions: SourceContribution[] = [];
    const labels: string[] = [];
    let visualPlaceholder = false;

    for (const seg of segments) {
      if (VISUAL_PLACEHOLDER_RE.test(seg)) {
        visualPlaceholder = true;
        continue;
      }
      if (isCitationSegment(seg)) {
        // Attribution rides along with the fact it supports (same unit).
        const prev = contributions[contributions.length - 1];
        if (prev && !/\(.*(?:19|20)\d{2}.*\)\.?$/.test(prev.text)) {
          const cite = seg.replace(CITATION_NOISE_RE, " ").replace(/\s{2,}/g, " ").replace(/[.\s]+$/g, "").trim();
          if (cite) prev.text = `${prev.text.replace(/[.\s]+$/g, "")} (${cite}).`;
        } else {
          labels.push(seg);
        }
        continue;
      }
      const cls = classifyContribution(seg);
      if (cls.kind === "label") {
        labels.push(seg);
        continue;
      }
      const w: Weighted = { tokens: cls.tokens, terms: new Set(cls.terms), numbers: cls.numbers };
      // Source-internal repeat? (progressive-animation slides, recap slides)
      let introducedBy = unit.id;
      for (const e of earlier) {
        const { score, numbersOk } = informationScore(w, e.set, e.c.tokens, e.nums);
        if (numbersOk && score >= REDUNDANT_MIN_SCORE) {
          introducedBy = e.c.introducedBy;
          break;
        }
      }
      const c: SourceContribution = {
        id: `${unit.id}#${contributions.length}`,
        unitId: unit.id,
        order: unit.order,
        text: seg,
        tokens: cls.tokens,
        numbers: cls.numbers,
        terms: cls.terms,
        kind: "sentence",
        introducedHere: introducedBy === unit.id,
        introducedBy,
      };
      contributions.push(c);
      all.push(c);
      if (c.introducedHere) {
        earlier.push({ c, w, set: new Set(c.tokens), nums: new Set(c.numbers) });
      }
    }

    let kind: LedgerUnitKind = "substantive";
    if (contributions.length === 0) {
      const titleOnly =
        labels.length > 0 &&
        labels.length <= 2 &&
        labels.every((l) => l.split(/\s+/).length <= 6) &&
        (labels.length === 1 || normalizeLine(labels[0]!) === normalizeLine(label));
      if (AGENDA_RE.test(blob) && !HARD_FACT_CUE_RE.test(blob)) {
        // Agenda / objectives / logistics made of short label lines.
        kind = "non-substantive";
      } else if (!visualPlaceholder && titleOnly) {
        // Title / transition slide: just its heading (plus at most a subtitle).
        kind = "non-substantive";
      } else {
        kind = visualPlaceholder || labels.length > 0 ? "visual-only" : "non-substantive";
      }
    } else if (AGENDA_RE.test(blob) && !HARD_FACT_CUE_RE.test(blob)) {
      kind = "non-substantive";
    } else if (
      // Title / transition slide: one short line, nothing else on it.
      contributions.length === 1 &&
      labels.length === 0 &&
      contributions[0]!.numbers.length === 0 &&
      contributions[0]!.text.split(/\s+/).length <= 6
    ) {
      kind = "non-substantive";
    }
    ledgerUnits.push({ unit, kind, contributions, labels });
  }

  return { units: ledgerUnits, contributions: all };
}

// ── Audit ──────────────────────────────────────────────────────────────────

export type UnitCoverageStatus =
  | "covered"
  | "redundant"
  | "non-substantive"
  | "visual-only"
  | "missing";

export type UnitCoverage = {
  unitId: string;
  label: string;
  order: number;
  sourceId?: string;
  status: UnitCoverageStatus;
  /** Contributions this unit introduces (source-internal repeats excluded). */
  introduced: number;
  covered: number;
  missing: SourceContribution[];
  /** Section ids that cover this unit's contributions (most hits first). */
  coveringSections: string[];
};

export type SourceCoverageAudit = {
  units: UnitCoverage[];
  counts: {
    total: number;
    substantive: number;
    covered: number;
    redundant: number;
    nonSubstantive: number;
    visualOnly: number;
    missing: number;
    contributions: number;
    contributionsMissing: number;
  };
  missingRanges: UnrepresentedRange[];
  visualOnlyUnitIds: string[];
};

export type CoverageNoteSection = {
  sectionId: string;
  markdown: string;
  studentEdited?: boolean;
};

type Window = { sectionId: string | null; tokens: Set<string>; list: string[]; numbers: Set<string> };

const WINDOW_MAX_LINES = 3;

function isBodyLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (/^\|\s*:?-{3,}/.test(t)) return false;
  if (/^-{3,}$/.test(t)) return false;
  return true;
}

function lineInfo(line: string): { tokens: string[]; numbers: string[] } {
  // Tokens from the plain line (number words stay words, matching the
  // contribution side); numbers from the digitized line ("three" → "3").
  const norm = normalizeLine(line.replace(EXPONENT_RE, "$1"));
  return {
    tokens: tokenizeNoteText(norm),
    numbers: numberTokens(digitizeNumberWords(norm)),
  };
}

function buildWindows(sections: CoverageNoteSection[], extraMarkdown?: string): Window[] {
  const windows: Window[] = [];
  const addDoc = (sectionId: string | null, markdown: string) => {
    const lines = markdown
      .replace(/\r\n/g, "\n")
      .split("\n")
      .filter(isBodyLine)
      .map(lineInfo);
    for (let i = 0; i < lines.length; i++) {
      for (let len = 1; len <= WINDOW_MAX_LINES && i + len <= lines.length; len++) {
        const tokens = new Set<string>();
        const numbers = new Set<string>();
        for (let k = i; k < i + len; k++) {
          for (const t of lines[k]!.tokens) tokens.add(t);
          for (const n of lines[k]!.numbers) {
            numbers.add(n);
            numbers.add(n.split(" ")[0]!);
          }
        }
        windows.push({ sectionId, tokens, list: [...tokens], numbers });
      }
    }
  };
  for (const s of sections) addDoc(s.sectionId, s.markdown);
  if (extraMarkdown?.trim()) addDoc(null, extraMarkdown);
  return windows;
}

function contributionCovered(
  c: SourceContribution,
  windows: Window[]
): { covered: boolean; sectionId: string | null; score: number } {
  const w: Weighted = { tokens: c.tokens, terms: new Set(c.terms), numbers: c.numbers };
  let best = 0;
  let bestSection: string | null = null;
  for (const win of windows) {
    // Cheap prefilter: at least one token overlap.
    if (!c.tokens.some((t) => win.tokens.has(t))) continue;
    const { score, numbersOk } = informationScore(w, win.tokens, win.list, win.numbers);
    if (!numbersOk) continue;
    if (score > best) {
      best = score;
      bestSection = win.sectionId;
      if (best >= 1) break;
    }
  }
  return { covered: best >= COVERED_MIN_SCORE, sectionId: bestSection, score: best };
}

function contiguousRanges(missing: UnitCoverage[]): UnrepresentedRange[] {
  if (missing.length === 0) return [];
  const sorted = [...missing].sort((a, b) => a.order - b.order);
  const ranges: UnrepresentedRange[] = [];
  let cur: UnrepresentedRange | null = null;
  for (const u of sorted) {
    if (cur && u.order === cur.toOrder + 1) {
      cur.toOrder = u.order;
      cur.ids.push(u.unitId);
      cur.labels.push(u.label);
    } else {
      if (cur) ranges.push(cur);
      cur = { fromOrder: u.order, toOrder: u.order, ids: [u.unitId], labels: [u.label] };
    }
  }
  if (cur) ranges.push(cur);
  return ranges;
}

/**
 * Classify every source unit against the FINAL notes. `sections` are the
 * addressable note sections (student-edited ones count for coverage but are
 * never repair targets); `extraMarkdown` is any unaddressable note text that
 * still counts as present (e.g. blocks without section ids).
 */
export function auditSourceCoverage(
  ledger: SourceCoverageLedger,
  sections: CoverageNoteSection[],
  extraMarkdown?: string
): SourceCoverageAudit {
  const windows = buildWindows(sections, extraMarkdown);
  const units: UnitCoverage[] = [];
  let contributionsMissing = 0;

  for (const lu of ledger.units) {
    const base = {
      unitId: lu.unit.id,
      label: (lu.unit.label ?? "").trim(),
      order: lu.unit.order,
      sourceId: lu.unit.sourceId,
    };
    if (lu.kind === "non-substantive") {
      units.push({ ...base, status: "non-substantive", introduced: 0, covered: 0, missing: [], coveringSections: [] });
      continue;
    }
    if (lu.kind === "visual-only") {
      units.push({ ...base, status: "visual-only", introduced: 0, covered: 0, missing: [], coveringSections: [] });
      continue;
    }
    const introduced = lu.contributions.filter((c) => c.introducedHere);
    if (introduced.length === 0) {
      units.push({ ...base, status: "redundant", introduced: 0, covered: 0, missing: [], coveringSections: [] });
      continue;
    }
    const missing: SourceContribution[] = [];
    const hits = new Map<string, number>();
    let covered = 0;
    for (const c of introduced) {
      const r = contributionCovered(c, windows);
      if (r.covered) {
        covered += 1;
        if (r.sectionId) hits.set(r.sectionId, (hits.get(r.sectionId) ?? 0) + 1);
      } else {
        missing.push(c);
      }
    }
    contributionsMissing += missing.length;
    units.push({
      ...base,
      status: missing.length === 0 ? "covered" : "missing",
      introduced: introduced.length,
      covered,
      missing,
      coveringSections: [...hits.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]),
    });
  }

  const count = (s: UnitCoverageStatus) => units.filter((u) => u.status === s).length;
  const missingUnits = units.filter((u) => u.status === "missing");
  return {
    units,
    counts: {
      total: units.length,
      substantive: units.filter((u) => u.status === "covered" || u.status === "missing").length,
      covered: count("covered"),
      redundant: count("redundant"),
      nonSubstantive: count("non-substantive"),
      visualOnly: count("visual-only"),
      missing: missingUnits.length,
      contributions: ledger.contributions.filter((c) => c.introducedHere).length,
      contributionsMissing,
    },
    missingRanges: contiguousRanges(missingUnits),
    visualOnlyUnitIds: units.filter((u) => u.status === "visual-only").map((u) => u.unitId),
  };
}

export function formatSourceCoverageAudit(audit: SourceCoverageAudit): string {
  const c = audit.counts;
  const ranges = audit.missingRanges
    .map((r) => (r.ids.length === 1 ? r.ids[0] : `${r.ids[0]}–${r.ids[r.ids.length - 1]}`))
    .join(", ");
  return (
    `${c.total} source units: ${c.covered} covered, ${c.redundant} redundant, ` +
    `${c.nonSubstantive} non-substantive, ${c.visualOnly} visual-only, ${c.missing} missing` +
    ` (${c.contributionsMissing}/${c.contributions} contributions missing` +
    (ranges ? `; missing ranges: ${ranges}` : "") +
    ")"
  );
}

// ── Repair ─────────────────────────────────────────────────────────────────

export type CoverageRepair =
  | { kind: "extend"; sectionId: string; markdown: string; unitIds: string[] }
  | { kind: "new"; sectionId: string; markdown: string; unitIds: string[] };

/** Words that must not end a heading. */
const HEADING_TRAIL_RE =
  /\s+(?:a|an|the|of|to|in|on|at|by|for|from|with|and|or|but|as|into|than|that|which|who|is|are|was|were|be|has|have|had|not|its|their|this|these|those|called|between|through|via|during|until|after|before|when|where|while|because|if|so|then|also|per|over|under|about|across|along|among|around|within|without|upon|may|can|will|would|should|must|very|more|most)$/i;

function deShout(word: string): string {
  if (/^[A-Z]{5,}s?$/.test(word)) {
    return word[0]! + word.slice(1).toLowerCase();
  }
  return word;
}

function cleanHeadingText(raw: string): string {
  const words = raw
    .replace(/\*\*/g, "")
    .replace(/[“”"]/g, "")
    .replace(/[.:;,!?]+$/g, "")
    .trim()
    .split(/\s+/)
    .map(deShout);
  let text = words.join(" ");
  for (let i = 0; i < 3 && HEADING_TRAIL_RE.test(text); i++) {
    text = text.replace(HEADING_TRAIL_RE, "");
  }
  text = text.replace(/[,(–—-]+$/g, "").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Fragment starts that make a label unusable as a heading. */
const FRAGMENT_START_RE =
  /^(?:this|these|those|here|it|its|in|on|at|of|for|and|or|but|so|the|a|an|there|then|also|however|as|by|to|from|with|we|you|they|he|she)\b/i;
/** Main verbs: the words before one form the subject noun phrase. */
const VERB_SPLIT_RE =
  /\s(?:is|are|was|were|has|have|had|causes?|caused|allows?|allowed|requires?|required|results?|resulted|leads?|led|undergo(?:es)?|underwent|depends?|depended|holds?|held|regulates?|regulated|induces?|induced|promotes?|promoted|maintains?|maintained|produces?|produced|occurs?|occurred|shows?|showed|reveals?|revealed|ensures?|ensured|provides?|provided|disrupts?|disrupted|means|involves?|involved|includes?|included|forms?|formed|creates?|created|enables?|enabled|prevents?|prevented|generates?|generated|releases?|released|separates?|separated|binds?|bound|contains?|contained|remains?|remained|relies|rely|rel(?:y|ies) on|can|may|will|must|should|does|do|did)\s/i;

function titleLike(text: string): boolean {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 12) return false;
  if (!/^[A-Z0-9“"]/.test(text)) return false;
  if (FRAGMENT_START_RE.test(text) && words.length <= 4) return false;
  if (/[,;:(–—-]$|\b(?:a|an|the|of|to|in|and|or|is|are|was|were)$/i.test(text.trim())) return false;
  return true;
}

function headingFromUnit(lu: SourceLedgerUnit, missing: SourceContribution[]): string {
  const label = (lu.unit.label ?? "").trim();
  if (
    titleLike(label) &&
    !/^\(?slide \d+/i.test(label) &&
    !VISUAL_PLACEHOLDER_RE.test(label) &&
    !CITATION_RE.test(label)
  ) {
    // A sentence-shaped title keeps only its subject ("Inhibition of condensins").
    const subject = label.split(VERB_SPLIT_RE)[0]!.trim();
    const h = cleanHeadingText(subject.split(/\s+/).length >= 2 ? subject : label);
    if (h.split(/\s+/).length >= 2) return h;
  }
  // A one-word topic label ("Inhibition", "Osmosis") beats a sentence heading.
  if (
    /^\p{Lu}[\p{L}-]{3,}$/u.test(label) &&
    !FRAGMENT_START_RE.test(label) &&
    !CITATION_RE.test(label)
  ) {
    return label;
  }
  // A quoted key term on the slide names the topic (“maternal age effect”).
  for (const c of missing) {
    const q = c.text.match(/[“"]([^”"]{4,60})[”"]/);
    if (q && q[1]!.split(/\s+/).length >= 2 && q[1]!.split(/\s+/).length <= 6) {
      return cleanHeadingText(q[1]!);
    }
  }
  // Subject noun phrase of the most informative missing sentence.
  const richest = [...missing].sort((a, b) => b.tokens.length - a.tokens.length)[0] ?? missing[0];
  if (richest) {
    const subject = richest.text.split(VERB_SPLIT_RE)[0]!.replace(/^(?:the|a|an|this|these|those|here|in|there)\s+/i, "");
    const words = subject.trim().split(/\s+/).filter(Boolean);
    if (words.length >= 2 && words.length <= 8) {
      const h = cleanHeadingText(words.join(" "));
      if (h.split(/\s+/).length >= 2) return h;
    }
    // No recognizable subject: a short opening clause, never the whole sentence.
    const clause = richest.text.split(/[,;:—(]|\s(?:which|that|because|so that|where|without|with|by|for|to)\s/)[0]!;
    const h = cleanHeadingText(clause.trim().split(/\s+/).slice(0, 6).join(" "));
    if (h.split(/\s+/).length >= 2) return h;
  }
  return `Source ${lu.unit.id}`;
}

function restoreLine(text: string): string {
  let t = normalizeSourceText(text).replace(/\s+/g, " ").trim();
  t = t
    .replace(/^[-*•]\s+/, "")
    .replace(/^\*\s*/, "")
    .replace(/[;,]?\s*\b(?:see|at|visit)?\s*(?:https?:\/\/|www\.)\S+/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:!?)])/g, "$1")
    .trim();
  t = t.charAt(0).toUpperCase() + t.slice(1);
  if (/[A-Za-z0-9)”"]$/.test(t) && t.split(/\s+/).length >= 4) t += ".";
  return `- ${t}`;
}

function sectionTokenSet(md: string): { heading: Set<string>; body: Set<string> } {
  const heading = new Set(tokenizeNoteText(extractNoteHeading(md) ?? ""));
  const body = new Set(tokenizeNoteText(normalizeLine(md.replace(/^#{1,3}\s.*$/m, ""))));
  return { heading, body };
}

/**
 * Best AI-owned section for a missing unit: the section already covering
 * most of its other contributions, else the strongest heading/body overlap.
 */
function pickTargetSection(
  unit: UnitCoverage,
  lu: SourceLedgerUnit,
  sections: CoverageNoteSection[],
  tokenSets: Map<string, { heading: Set<string>; body: Set<string> }>
): string | null {
  const eligible = new Set(sections.filter((s) => !s.studentEdited).map((s) => s.sectionId));
  for (const sid of unit.coveringSections) {
    if (eligible.has(sid)) return sid;
  }
  const unitTokens = new Set<string>();
  for (const t of tokenizeNoteText(lu.unit.label ?? "")) unitTokens.add(t);
  for (const c of lu.contributions) for (const t of c.tokens) unitTokens.add(t);
  if (unitTokens.size === 0) return null;
  let best: string | null = null;
  let bestScore = 0;
  for (const s of sections) {
    if (!eligible.has(s.sectionId)) continue;
    const ts = tokenSets.get(s.sectionId)!;
    let hit = 0;
    let headingHits = 0;
    for (const t of unitTokens) {
      if (ts.heading.has(t)) {
        hit += 3;
        headingHits += 1;
      } else if (ts.body.has(t)) hit += 1;
    }
    const score = hit / (unitTokens.size * 1.5);
    if ((headingHits >= 2 || score >= 0.3) && score > bestScore) {
      bestScore = score;
      best = s.sectionId;
    }
  }
  return best;
}

export function planSourceCoverageRepairs(
  audit: SourceCoverageAudit,
  ledger: SourceCoverageLedger,
  sections: CoverageNoteSection[]
): CoverageRepair[] {
  const missing = audit.units.filter((u) => u.status === "missing" && u.missing.length > 0);
  if (missing.length === 0) return [];
  const byId = new Map(ledger.units.map((u) => [u.unit.id, u]));
  const tokenSets = new Map(sections.map((s) => [s.sectionId, sectionTokenSet(s.markdown)]));
  const headingIndex = new Map<string, string>();
  for (const s of sections) {
    const h = extractNoteHeading(s.markdown);
    if (h && !s.studentEdited) headingIndex.set(normalizeNoteHeading(h), s.sectionId);
  }
  const existingIds = new Set(sections.map((s) => s.sectionId));

  const extendLines = new Map<string, { lines: string[]; unitIds: string[] }>();
  const newSections: Array<{ sectionId: string; heading: string; lines: string[]; unitIds: string[]; lastOrder: number }> = [];

  for (const u of missing) {
    const lu = byId.get(u.unitId);
    if (!lu) continue;
    const lines = u.missing.map((c) => restoreLine(c.text));
    let target = pickTargetSection(u, lu, sections, tokenSets);
    if (!target) {
      // A derived heading that names an existing AI section folds into it.
      const heading = headingFromUnit(lu, u.missing);
      const collide = headingIndex.get(normalizeNoteHeading(heading));
      if (collide) target = collide;
      else {
        const prev = newSections[newSections.length - 1];
        if (prev && prev.lastOrder === u.order - 1) {
          // Contiguous missing units without a home share one new section.
          prev.lines.push(...lines);
          prev.unitIds.push(u.unitId);
          prev.lastOrder = u.order;
        } else {
          let sid = `src-cov-${u.unitId}`.replace(/[^a-zA-Z0-9_-]/g, "-");
          while (existingIds.has(sid)) sid = `${sid}-x`;
          existingIds.add(sid);
          newSections.push({ sectionId: sid, heading, lines, unitIds: [u.unitId], lastOrder: u.order });
        }
        continue;
      }
    }
    const cur = extendLines.get(target) ?? { lines: [], unitIds: [] };
    cur.lines.push(...lines);
    cur.unitIds.push(u.unitId);
    extendLines.set(target, cur);
  }

  const repairs: CoverageRepair[] = [];
  for (const [sectionId, v] of extendLines) {
    repairs.push({ kind: "extend", sectionId, markdown: v.lines.join("\n"), unitIds: v.unitIds });
  }
  for (const s of newSections) {
    repairs.push({
      kind: "new",
      sectionId: s.sectionId,
      markdown: [`## ${s.heading}`, ...s.lines].join("\n"),
      unitIds: s.unitIds,
    });
  }
  return repairs;
}

/** Fold an "extend" repair into a section's markdown (pure). */
export function extendSectionMarkdown(existing: string, incoming: string): string {
  const placed = placeIncomingNoteLines(existing.replace(/\s+$/, ""), incoming);
  let md = dedupeSectionLines(placed);
  // Placement may judge a line "already said"; the audit disagreed, so the
  // source wording is appended verbatim rather than silently dropped.
  const have = new Set(md.split("\n").map((l) => l.trim()));
  const tail: string[] = [];
  for (const line of incoming.split("\n")) {
    const t = line.trim();
    if (t && !have.has(t)) tail.push(line);
  }
  if (tail.length > 0) md = `${md.replace(/\s+$/, "")}\n${tail.join("\n")}`;
  return md;
}

export function applyCoverageRepairs(
  sections: CoverageNoteSection[],
  repairs: CoverageRepair[]
): CoverageNoteSection[] {
  const out = sections.map((s) => ({ ...s }));
  for (const r of repairs) {
    if (r.kind === "extend") {
      const s = out.find((x) => x.sectionId === r.sectionId);
      if (!s || s.studentEdited) {
        out.push({ sectionId: `${r.sectionId}-cov`, markdown: r.markdown, studentEdited: false });
        continue;
      }
      s.markdown = extendSectionMarkdown(s.markdown, r.markdown);
    } else {
      out.push({ sectionId: r.sectionId, markdown: r.markdown, studentEdited: false });
    }
  }
  return out;
}

export type CoverageRepairResult = {
  sections: CoverageNoteSection[];
  repairs: CoverageRepair[];
  before: SourceCoverageAudit;
  after: SourceCoverageAudit;
  passes: number;
};

/**
 * Audit → plan → apply → re-audit until no substantive unit is MISSING (or
 * a pass makes no progress). Deterministic; copies source wording only.
 */
export function repairSourceCoverage(
  ledger: SourceCoverageLedger,
  sections: CoverageNoteSection[],
  opts?: { extraMarkdown?: string; maxPasses?: number }
): CoverageRepairResult {
  const maxPasses = opts?.maxPasses ?? 3;
  let current = sections.map((s) => ({ ...s }));
  const before = auditSourceCoverage(ledger, current, opts?.extraMarkdown);
  let audit = before;
  const allRepairs: CoverageRepair[] = [];
  let passes = 0;
  while (audit.counts.missing > 0 && passes < maxPasses) {
    const repairs = planSourceCoverageRepairs(audit, ledger, current);
    if (repairs.length === 0) break;
    passes += 1;
    current = applyCoverageRepairs(current, repairs);
    allRepairs.push(...repairs);
    const next = auditSourceCoverage(ledger, current, opts?.extraMarkdown);
    const progressed = next.counts.contributionsMissing < audit.counts.contributionsMissing;
    audit = next;
    if (!progressed) break;
  }
  return { sections: current, repairs: allRepairs, before, after: audit, passes };
}

/** Compact, JSON-safe audit summary for clients / logs. */
export function summarizeSourceCoverageAudit(audit: SourceCoverageAudit): {
  total: number;
  substantive: number;
  covered: number;
  redundant: number;
  nonSubstantive: number;
  visualOnly: number;
  missing: number;
  contributions: number;
  contributionsMissing: number;
  missingUnitIds: string[];
  missingRanges: Array<{ from: string; to: string }>;
  visualOnlyUnitIds: string[];
} {
  return {
    ...audit.counts,
    missingUnitIds: audit.units.filter((u) => u.status === "missing").map((u) => u.unitId),
    missingRanges: audit.missingRanges.map((r) => ({
      from: r.ids[0]!,
      to: r.ids[r.ids.length - 1]!,
    })),
    visualOnlyUnitIds: audit.visualOnlyUnitIds,
  };
}

// ── Adapters ───────────────────────────────────────────────────────────────

/** Split a transcript into ordered source units (~`segmentChars` each, on sentence ends). */
export function transcriptToSourceUnits(
  transcript: string,
  opts?: { segmentChars?: number; sourceId?: string }
): SourceUnit[] {
  const size = opts?.segmentChars ?? 900;
  const sentences = transcript
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean);
  const units: SourceUnit[] = [];
  let buf = "";
  const flush = () => {
    if (!buf.trim()) return;
    units.push({
      id: `t${units.length + 1}`,
      text: buf.trim(),
      order: units.length,
      sourceId: opts?.sourceId ?? "transcript",
    });
    buf = "";
  };
  for (const s of sentences) {
    if (buf && buf.length + s.length + 1 > size) flush();
    buf = buf ? `${buf} ${s}` : s;
  }
  flush();
  return units;
}
