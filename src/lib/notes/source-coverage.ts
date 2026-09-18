/**
 * Generic source-unit coverage — deterministic, no model call.
 *
 * A source unit is whatever the upload naturally is: a slide, PDF page,
 * reading paragraph, transcript segment, figure/table, or ingest chunk.
 * After notes exist we can:
 *   1. list substantive units with no footprint in the notes;
 *   2. group those into contiguous skipped ranges;
 *   3. restore unique source lines the notes do not already contain
 *      (source wording, never invented facts).
 *
 * Used by tests and by live wrap-up. Restore never invents; it only
 * copies uncovered source lines into the notes.
 */

import {
  lineAddsNewInformation,
  tokenizeNoteText,
} from "@/lib/live-notes/fold-note-markdown";

export type SourceUnit = {
  /** Stable id (page number, chunk id, "fileA:p3", …). */
  id: string;
  /** Optional human label (slide title, heading). */
  label?: string;
  /** Extracted text (or visual-interpretation text) for this unit. */
  text: string;
  /** Document order (0-based). Units from several files share one sequence. */
  order: number;
  /** Optional file/source grouping for multi-upload coverage. */
  sourceId?: string;
};

export type CoverageDeckPage = {
  pageNum: number;
  title?: string;
  extractedText: string;
};

export type UnrepresentedUnit = {
  id: string;
  label: string;
  order: number;
  sourceId?: string;
  /** Share of the unit's distinct content tokens that appear in the notes. */
  overlap: number;
  tokenCount: number;
};

export type UnrepresentedRange = {
  fromOrder: number;
  toOrder: number;
  ids: string[];
  labels: string[];
};

export type SourceCoverageOptions = {
  /** Units with fewer distinct content tokens are treated as title/agenda. */
  minUnitTokens?: number;
  /** Overlap below this ⇒ the unit is unrepresented. */
  minOverlap?: number;
};

const DEFAULTS: Required<SourceCoverageOptions> = {
  minUnitTokens: 12,
  minOverlap: 0.25,
};

function isNonSubstantiveSourceText(label: string, text: string): boolean {
  const blob = `${label} ${text}`;
  if (
    /\b(agenda|today we will|today's agenda|logistics|announcements?|attendance|welcome(?: to)?(?: the)?(?: course)?|questions from last time|looking ahead|objectives? only)\b/i.test(
      blob
    )
  ) {
    const teachable =
      /\b(define|mechanism|equation|experiment|exception|figure|table|theorem|proof|example)\b/i.test(
        blob
      );
    if (!teachable) return true;
  }
  return false;
}

function sharesRoot(a: string, b: string): boolean {
  if (a === b) return true;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  return s.length >= 4 && l.startsWith(s) && l.length - s.length <= 4;
}

function unitTokenOverlap(unitText: string, noteTokens: Set<string>, noteList: string[]): number {
  const pageTokens = new Set(tokenizeNoteText(unitText));
  if (pageTokens.size === 0) return 1;
  let hit = 0;
  for (const t of pageTokens) {
    if (noteTokens.has(t) || noteList.some((n) => sharesRoot(n, t))) hit += 1;
  }
  return hit / pageTokens.size;
}

export function deckPagesToSourceUnits(pages: CoverageDeckPage[]): SourceUnit[] {
  return pages.map((p, i) => ({
    id: String(p.pageNum),
    label: (p.title ?? "").trim(),
    text: p.extractedText,
    order: i,
    sourceId: "deck",
  }));
}

/**
 * Substantive source units with (near) zero representation in `notesMarkdown`.
 * Sorted by `order`. Empty when every substantive unit is represented.
 */
export function findUnrepresentedSourceUnits(
  units: SourceUnit[],
  notesMarkdown: string,
  opts?: SourceCoverageOptions
): UnrepresentedUnit[] {
  const { minUnitTokens, minOverlap } = { ...DEFAULTS, ...opts };
  const noteTokens = new Set(tokenizeNoteText(notesMarkdown));
  const noteList = [...noteTokens];
  const out: UnrepresentedUnit[] = [];
  for (const u of units) {
    const blob = `${u.label ?? ""} ${u.text}`;
    if (isNonSubstantiveSourceText(u.label ?? "", u.text)) continue;
    const pageTokens = new Set(tokenizeNoteText(blob));
    if (pageTokens.size < minUnitTokens) continue;
    const overlap = unitTokenOverlap(blob, noteTokens, noteList);
    if (overlap < minOverlap) {
      out.push({
        id: u.id,
        label: (u.label ?? "").trim(),
        order: u.order,
        sourceId: u.sourceId,
        overlap,
        tokenCount: pageTokens.size,
      });
    }
  }
  return out.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

/** Consecutive unrepresented units (order gaps of 1). */
export function findUnrepresentedContiguousRanges(
  missing: UnrepresentedUnit[]
): UnrepresentedRange[] {
  if (missing.length === 0) return [];
  const sorted = [...missing].sort((a, b) => a.order - b.order);
  const ranges: UnrepresentedRange[] = [];
  let cur: UnrepresentedRange = {
    fromOrder: sorted[0]!.order,
    toOrder: sorted[0]!.order,
    ids: [sorted[0]!.id],
    labels: [sorted[0]!.label],
  };
  for (let i = 1; i < sorted.length; i++) {
    const u = sorted[i]!;
    if (u.order === cur.toOrder + 1) {
      cur.toOrder = u.order;
      cur.ids.push(u.id);
      cur.labels.push(u.label);
    } else {
      ranges.push(cur);
      cur = {
        fromOrder: u.order,
        toOrder: u.order,
        ids: [u.id],
        labels: [u.label],
      };
    }
  }
  ranges.push(cur);
  return ranges;
}

/**
 * Substantive deck pages with (near) zero representation in `notesMarkdown`.
 * Adapter over {@link findUnrepresentedSourceUnits}.
 */
export function findUnrepresentedDeckPages(
  pages: CoverageDeckPage[],
  notesMarkdown: string,
  opts?: SourceCoverageOptions
): Array<{
  pageNum: number;
  title: string;
  overlap: number;
  tokenCount: number;
}> {
  return findUnrepresentedSourceUnits(deckPagesToSourceUnits(pages), notesMarkdown, opts).map(
    (u) => ({
      pageNum: Number(u.id) || u.order + 1,
      title: u.label,
      overlap: u.overlap,
      tokenCount: u.tokenCount,
    })
  );
}

/** One-line human summary for logs (empty string when fully represented). */
export function formatUnrepresentedPages(
  pages: Array<{ pageNum: number; title: string; overlap: number }>
): string {
  if (pages.length === 0) return "";
  return pages
    .map(
      (p) =>
        `p${p.pageNum}${p.title ? ` "${p.title.slice(0, 40)}"` : ""} (${Math.round(p.overlap * 100)}%)`
    )
    .join(", ");
}

export function formatUnrepresentedUnits(units: UnrepresentedUnit[]): string {
  if (units.length === 0) return "";
  return units
    .map(
      (u) =>
        `${u.sourceId ? `${u.sourceId}:` : ""}${u.id}${u.label ? ` "${u.label.slice(0, 40)}"` : ""} (${Math.round(u.overlap * 100)}%)`
    )
    .join(", ");
}

const MIN_RESTORE_LINE = 12;

function sourceLines(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    for (const part of raw.split(/(?<=[.!?])\s+/)) {
      const t = part.trim();
      if (!t) continue;
      if (/^#{1,6}\s/.test(t)) continue;
      out.push(/^[-*]\s|^\d+\.\s/.test(t) ? t : `- ${t}`);
    }
  }
  return out;
}

function lineCoveredByNotes(line: string, noteLines: string[]): boolean {
  const n = line.replace(/^\s*(?:[-*]|\d+\.)\s+/, "").trim();
  if (n.length < MIN_RESTORE_LINE) return true;
  return noteLines.some((p) => {
    if (!p.trim()) return false;
    return !lineAddsNewInformation(p, line);
  });
}

/**
 * Unique teachable lines from `unit` that the notes do not already contain.
 * Uses the source's own wording — never invents.
 */
export function uncoveredSourceLines(unit: SourceUnit, notesMarkdown: string): string[] {
  const noteLines = notesMarkdown.split("\n").filter((l) => l.trim().length >= 8);
  const picked: string[] = [];
  for (const line of sourceLines(unit.text)) {
    // A sentence the source itself repeats is copied once.
    if (lineCoveredByNotes(line, noteLines) || lineCoveredByNotes(line, picked)) continue;
    picked.push(line);
  }
  return picked;
}

export type RestoredSourceSection = {
  sectionId: string;
  markdown: string;
  sourceUnitIds: string[];
};

/**
 * Build restore sections for unrepresented units (contiguous units that
 * share a sourceId are grouped). Empty when every unique source line is
 * already in the notes.
 */
export function restoreUnrepresentedSourceUnits(
  units: SourceUnit[],
  notesMarkdown: string,
  opts?: SourceCoverageOptions
): {
  missing: UnrepresentedUnit[];
  ranges: UnrepresentedRange[];
  sections: RestoredSourceSection[];
} {
  const missing = findUnrepresentedSourceUnits(units, notesMarkdown, opts);
  const ranges = findUnrepresentedContiguousRanges(missing);
  const byId = new Map(units.map((u) => [u.id, u]));
  const missingIds = new Set(missing.map((m) => m.id));
  const sections: RestoredSourceSection[] = [];
  let restoredNotes = notesMarkdown;

  const flush = (ids: string[], heading: string, lines: string[]) => {
    if (lines.length === 0) return;
    const sid = `src-restore-${ids[0] ?? heading.slice(0, 12)}`;
    sections.push({
      sectionId: sid,
      markdown: [`## ${heading}`, ...lines].join("\n"),
      sourceUnitIds: ids,
    });
  };

  for (const range of ranges) {
    const lines: string[] = [];
    const ids: string[] = [];
    let heading = "";
    for (const id of range.ids) {
      const u = byId.get(id);
      if (!u || isNonSubstantiveSourceText(u.label ?? "", u.text)) continue;
      const extra = uncoveredSourceLines(u, restoredNotes);
      if (extra.length === 0) continue;
      ids.push(id);
      if (!heading) heading = (u.label ?? "").trim() || `Source ${id}`;
      lines.push(...extra);
      restoredNotes += `\n${extra.join("\n")}`;
    }
    flush(ids, heading || "Source", lines);
  }

  // Units that token-overlap the notes can still hold a unique exception,
  // number, or example. Copy only uncovered lines (never the restated bulk).
  for (const u of units) {
    if (missingIds.has(u.id)) continue;
    if (isNonSubstantiveSourceText(u.label ?? "", u.text)) continue;
    const extra = uncoveredSourceLines(u, restoredNotes);
    if (extra.length === 0) continue;
    flush(
      [u.id],
      (u.label ?? "").trim() || `Source ${u.id}`,
      extra
    );
    restoredNotes += `\n${extra.join("\n")}`;
  }

  return { missing, ranges, sections };
}
