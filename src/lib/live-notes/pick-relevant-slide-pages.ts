import {
  MAX_DECK_SYNTH_CHARS,
  type DeckPage,
} from "@/lib/live-notes/slide-pages";

const STOP = new Set([
  "the",
  "and",
  "for",
  "that",
  "this",
  "with",
  "from",
  "have",
  "has",
  "had",
  "were",
  "was",
  "are",
  "been",
  "being",
  "will",
  "would",
  "could",
  "should",
  "can",
  "may",
  "might",
  "not",
  "but",
  "than",
  "then",
  "there",
  "here",
  "what",
  "when",
  "which",
  "who",
  "how",
  "why",
  "you",
  "they",
  "them",
  "our",
  "your",
  "just",
  "about",
  "into",
  "over",
  "after",
  "before",
  "also",
  "more",
  "most",
  "some",
  "any",
  "okay",
  "like",
  "right",
  "yeah",
  "going",
  "gonna",
  "want",
  "know",
  "think",
  "really",
  "very",
  "let",
  "lets",
  "see",
  "look",
  "next",
  "slide",
  "page",
]);

function tokenize(raw: string): string[] {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOP.has(t));
}

function countOverlap(haystack: Set<string>, needles: string[]): number {
  let n = 0;
  for (const t of needles) {
    if (haystack.has(t)) n += 1;
  }
  return n;
}

function formatPage(page: DeckPage, remaining: number): string {
  const head = page.title.trim()
    ? `[slide ${page.pageNum}] ${page.title.trim()}`
    : `[slide ${page.pageNum}]`;
  const body = page.extractedText.trim();
  const block = `${head}\n${body}`;
  if (block.length <= remaining) return block;
  return block.slice(0, Math.max(0, remaining - 1)).trimEnd() + "…";
}

/**
 * Pick 1–2 deck pages that match the current speech. Unmatched / unreached
 * slides are omitted so the model cannot dump the rest of the deck.
 */
export function pickRelevantSlidePages(input: {
  pages: DeckPage[];
  transcriptSlice: string;
  rollingSummary?: string;
  recentHeadings?: string[];
  lastPageNum?: number;
  maxChars?: number;
}): { text: string; pageNums: number[] } {
  const maxChars = input.maxChars ?? MAX_DECK_SYNTH_CHARS;
  if (input.pages.length === 0) return { text: "", pageNums: [] };

  const query = [
    ...tokenize(input.transcriptSlice),
    ...tokenize((input.recentHeadings ?? []).join(" ")),
    ...tokenize((input.recentHeadings ?? []).join(" ")),
    ...tokenize(input.rollingSummary ?? ""),
  ];
  if (query.length < 2) return { text: "", pageNums: [] };

  const scored = input.pages.map((page) => {
    const titleToks = new Set(tokenize(page.title));
    const bodyToks = new Set(tokenize(`${page.title} ${page.extractedText}`));
    let score =
      countOverlap(titleToks, query) * 3 + countOverlap(bodyToks, query);
    if (input.lastPageNum != null) {
      if (page.pageNum === input.lastPageNum) score *= 1.2;
      else if (page.pageNum === input.lastPageNum + 1) score *= 1.12;
    }
    return { page, score };
  });

  scored.sort((a, b) => b.score - a.score || a.page.pageNum - b.page.pageNum);
  const best = scored[0];
  if (!best || best.score < 2) return { text: "", pageNums: [] };

  const chosen: DeckPage[] = [best.page];
  const runnerUp = scored[1];
  if (
    runnerUp &&
    runnerUp.score >= best.score * 0.55 &&
    Math.abs(runnerUp.page.pageNum - best.page.pageNum) <= 1
  ) {
    chosen.push(runnerUp.page);
    chosen.sort((a, b) => a.pageNum - b.pageNum);
  }

  const parts: string[] = [];
  let used = 0;
  const pageNums: number[] = [];
  for (const page of chosen) {
    const remaining = maxChars - used;
    if (remaining < 80) break;
    const block = formatPage(page, remaining);
    if (!block) continue;
    if (parts.length > 0) used += 2;
    parts.push(block);
    used += block.length;
    pageNums.push(page.pageNum);
  }

  return { text: parts.join("\n\n"), pageNums };
}

/**
 * Choose which existing AI sections to offer for @@revise when speech arrives.
 * Prefers sections whose markdown overlaps the new transcript (slide drafts
 * sitting at the start of the doc would otherwise never be in the last-N window).
 */
export function pickRevisableByTranscript<
  T extends { markdown: string },
>(sections: T[], transcriptSlice: string, limit = 4): T[] {
  if (sections.length <= limit) return sections;
  const query = tokenize(transcriptSlice);
  if (query.length < 2) return sections.slice(-limit);
  const scored = sections.map((section, index) => ({
    section,
    index,
    score: countOverlap(new Set(tokenize(section.markdown)), query),
  }));
  scored.sort((a, b) => b.score - a.score || b.index - a.index);
  const matched = scored.filter((s) => s.score >= 2).slice(0, limit);
  if (matched.length === 0) return sections.slice(-limit);
  return matched.sort((a, b) => a.index - b.index).map((s) => s.section);
}

