/**
 * Source-coverage report for generated notes — deterministic, no model call.
 *
 * Given the pages of an uploaded deck and the final note sections, list the
 * substantive pages that have essentially no representation in the notes
 * (content-token overlap below a floor). Used by tests as a comprehensiveness
 * assertion and by the live wrap-up as a diagnostic log line. It never
 * changes the notes.
 */

import { tokenizeNoteText } from "@/lib/live-notes/fold-note-markdown";

export type CoverageDeckPage = {
  pageNum: number;
  title?: string;
  extractedText: string;
};

export type UnrepresentedPage = {
  pageNum: number;
  title: string;
  /** Share of the page's distinct content tokens that appear in the notes. */
  overlap: number;
  /** Distinct content tokens on the page (size filter for "substantive"). */
  tokenCount: number;
};

export type DeckCoverageOptions = {
  /** Pages with fewer distinct content tokens are treated as title/agenda slides. */
  minPageTokens?: number;
  /** Overlap below this ⇒ the page is unrepresented. */
  minOverlap?: number;
};

const DEFAULTS: Required<DeckCoverageOptions> = {
  minPageTokens: 12,
  minOverlap: 0.25,
};

function sharesRoot(a: string, b: string): boolean {
  if (a === b) return true;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  return s.length >= 4 && l.startsWith(s) && l.length - s.length <= 4;
}

/**
 * Substantive deck pages with (near) zero representation in `notesMarkdown`.
 * Sorted by page number. Empty when every substantive page is represented.
 */
export function findUnrepresentedDeckPages(
  pages: CoverageDeckPage[],
  notesMarkdown: string,
  opts?: DeckCoverageOptions
): UnrepresentedPage[] {
  const { minPageTokens, minOverlap } = { ...DEFAULTS, ...opts };
  const noteTokens = new Set(tokenizeNoteText(notesMarkdown));
  // Prefix index so "binding" on a slide is covered by "bind" in the notes.
  const noteList = [...noteTokens];
  const out: UnrepresentedPage[] = [];
  for (const p of pages) {
    const pageTokens = new Set(tokenizeNoteText(`${p.title ?? ""} ${p.extractedText}`));
    if (pageTokens.size < minPageTokens) continue;
    let hit = 0;
    for (const t of pageTokens) {
      if (noteTokens.has(t) || noteList.some((n) => sharesRoot(n, t))) hit += 1;
    }
    const overlap = hit / pageTokens.size;
    if (overlap < minOverlap) {
      out.push({
        pageNum: p.pageNum,
        title: (p.title ?? "").trim(),
        overlap,
        tokenCount: pageTokens.size,
      });
    }
  }
  return out.sort((a, b) => a.pageNum - b.pageNum);
}

/** One-line human summary for logs (empty string when fully represented). */
export function formatUnrepresentedPages(pages: UnrepresentedPage[]): string {
  if (pages.length === 0) return "";
  return pages
    .map((p) => `p${p.pageNum}${p.title ? ` "${p.title.slice(0, 40)}"` : ""} (${Math.round(p.overlap * 100)}%)`)
    .join(", ");
}
