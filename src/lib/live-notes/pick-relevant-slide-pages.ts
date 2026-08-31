import {
  formatDeckPages,
  MAX_DECK_SYNTH_CHARS,
  type DeckPage,
} from "@/lib/live-notes/slide-pages";
import { extractNoteHeading } from "@/lib/live-notes/fold-note-markdown";

/** Cap for lecture-chat deck context (relevant pages + title index). */
export const MAX_CHAT_DECK_CHARS = 16_000;
const MAX_CHAT_TOC_CHARS = 1_800;
const MAX_CHAT_FALLBACK_CHARS = 6_000;
const MAX_CHAT_EXPLICIT_PAGES = 8;

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
  minQueryTokens?: number;
  minScore?: number;
}): { text: string; pageNums: number[] } {
  const maxChars = input.maxChars ?? MAX_DECK_SYNTH_CHARS;
  const minQueryTokens = input.minQueryTokens ?? 2;
  const minScore = input.minScore ?? 2;
  if (input.pages.length === 0) return { text: "", pageNums: [] };

  const query = [
    ...tokenize(input.transcriptSlice),
    ...tokenize((input.recentHeadings ?? []).join(" ")),
    ...tokenize((input.recentHeadings ?? []).join(" ")),
    ...tokenize(input.rollingSummary ?? ""),
  ];
  if (query.length < minQueryTokens) return { text: "", pageNums: [] };

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
  if (!best || best.score < minScore) return { text: "", pageNums: [] };

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
 * Mixes the newest sections (live continuation) with earlier ones whose
 * heading/body overlap the slice (slide drafts at the top of the doc would
 * otherwise never be in a last-N window).
 */
export function pickRevisableByTranscript<
  T extends { markdown: string },
>(sections: T[], transcriptSlice: string, limit = 6): T[] {
  if (sections.length <= limit) return sections;
  const query = tokenize(transcriptSlice);
  if (query.length < 2) return sections.slice(-limit);

  const recentCount = Math.min(2, sections.length);
  const recent = sections.slice(-recentCount);
  const recentSet = new Set(recent);
  const scored = sections.map((section, index) => {
    const heading = extractNoteHeading(section.markdown) ?? "";
    const headingToks = new Set(tokenize(heading));
    const bodyToks = new Set(tokenize(section.markdown));
    const headingScore = countOverlap(headingToks, query);
    const bodyScore = countOverlap(bodyToks, query);
    return {
      section,
      index,
      headingScore,
      score: headingScore * 3 + bodyScore,
    };
  });
  const matched = scored
    .filter((s) => !recentSet.has(s.section))
    .filter((s) => s.headingScore >= 1 || s.score >= 2)
    .sort((a, b) => b.score - a.score || b.index - a.index)
    .slice(0, Math.max(0, limit - recent.length));

  if (matched.length === 0) return sections.slice(-limit);

  const picked = new Set<T>([
    ...matched.map((s) => s.section),
    ...recent,
  ]);
  return sections.filter((s) => picked.has(s));
}

/** "slide 12", "slides 5-7", "page 3", "pp. 8–10" */
export function parseSlideNumsFromQuery(message: string): number[] {
  const nums = new Set<number>();
  const re =
    /(?:slides?|pages?|pp\.?)\s*#?\s*(\d{1,3})(?:\s*[-–—to]+\s*(\d{1,3}))?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(message))) {
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    if (!Number.isFinite(a) || a < 1) continue;
    const lo = Math.min(a, Number.isFinite(b) ? b : a);
    const hi = Math.max(a, Number.isFinite(b) ? b : a);
    for (let n = lo; n <= hi && n - lo < MAX_CHAT_EXPLICIT_PAGES; n++) {
      if (n >= 1) nums.add(n);
    }
  }
  return [...nums].sort((x, y) => x - y);
}

export function formatDeckToc(
  pages: DeckPage[],
  maxChars = MAX_CHAT_TOC_CHARS
): string {
  if (pages.length === 0) return "";
  const lines: string[] = [];
  let used = 0;
  for (const p of pages) {
    const title = p.title.trim() || "(untitled)";
    const line = `${p.pageNum}. ${title}`.slice(0, 80);
    if (used + line.length + 1 > maxChars) {
      lines.push(`… +${pages.length - lines.length} more slides`);
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }
  return lines.join("\n");
}

function pagesByNum(pages: DeckPage[], nums: number[]): DeckPage[] {
  const map = new Map(pages.map((p) => [p.pageNum, p]));
  const out: DeckPage[] = [];
  const seen = new Set<number>();
  for (const n of nums) {
    if (seen.has(n)) continue;
    const p = map.get(n);
    if (!p) continue;
    seen.add(n);
    out.push(p);
  }
  return out;
}

function expandNeighbors(nums: number[], maxPages: number): number[] {
  const set = new Set<number>();
  for (const n of nums) {
    if (n > 1) set.add(n - 1);
    set.add(n);
    set.add(n + 1);
  }
  return [...set].filter((n) => n > 0).sort((a, b) => a - b).slice(0, maxPages);
}

function joinDeckAndToc(body: string, toc: string, maxChars: number): string {
  const tocBlock = toc
    ? `DECK INDEX (slide titles — full text is only included for the slides above):\n${toc}`
    : "";
  if (!tocBlock) return body.slice(0, maxChars);
  if (!body.trim()) return tocBlock.slice(0, maxChars);
  const sep = "\n\n";
  const room = maxChars - tocBlock.length - sep.length;
  if (room < 120) return body.slice(0, maxChars);
  return `${body.slice(0, room).trimEnd()}${sep}${tocBlock}`;
}

/**
 * Lecture-chat deck context: explicit slide numbers, else relevance pick,
 * else a short prefix + title index. Never dumps a 100-page deck.
 */
export function pickSlidePagesForChat(input: {
  pages: DeckPage[];
  message: string;
  transcript?: string;
  rollingSummary?: string;
  recentHeadings?: string[];
  notesSnippet?: string;
  maxChars?: number;
}): { text: string; pageNums: number[] } {
  const maxChars = input.maxChars ?? MAX_CHAT_DECK_CHARS;
  if (input.pages.length === 0) return { text: "", pageNums: [] };

  const toc = formatDeckToc(input.pages);
  const bodyBudget = Math.max(1_200, maxChars - Math.min(toc.length + 80, 2_000));

  const explicit = parseSlideNumsFromQuery(input.message);
  if (explicit.length > 0) {
    const chosen = pagesByNum(
      input.pages,
      expandNeighbors(explicit, MAX_CHAT_EXPLICIT_PAGES)
    );
    if (chosen.length > 0) {
      return {
        text: joinDeckAndToc(formatDeckPages(chosen, bodyBudget), toc, maxChars),
        pageNums: chosen.map((p) => p.pageNum),
      };
    }
  }

  const relevant = pickRelevantSlidePages({
    pages: input.pages,
    transcriptSlice: [
      input.message,
      input.message,
      input.transcript ?? "",
      input.notesSnippet ?? "",
    ].join("\n"),
    rollingSummary: input.rollingSummary,
    recentHeadings: input.recentHeadings,
    maxChars: bodyBudget,
    minQueryTokens: 1,
    minScore: 1,
  });
  if (relevant.text) {
    return {
      text: joinDeckAndToc(relevant.text, toc, maxChars),
      pageNums: relevant.pageNums,
    };
  }

  const fallbackPages: DeckPage[] = [];
  let used = 0;
  for (const p of input.pages) {
    const blockLen = p.title.length + p.extractedText.length + 24;
    if (fallbackPages.length > 0 && used + blockLen > MAX_CHAT_FALLBACK_CHARS) {
      break;
    }
    fallbackPages.push(p);
    used += blockLen;
    if (fallbackPages.length >= 6) break;
  }
  return {
    text: joinDeckAndToc(
      formatDeckPages(fallbackPages, Math.min(MAX_CHAT_FALLBACK_CHARS, bodyBudget)),
      toc,
      maxChars
    ),
    pageNums: fallbackPages.map((p) => p.pageNum),
  };
}

