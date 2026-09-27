/**
 * Deterministic cleanup of extracted page text before any AI call: undo
 * letter-spaced runs and split ligatures, then drop page numbers, repeated
 * headers/footers, logo lines and duplicate lines.
 */

export type SourcePage = { n: number; text: string };

const BULLET_ONLY = /^[•◦▪▫●○■□►▸‣⁃\-–—*]$/;

const PAGE_NUMBER_PATTERNS = [
  /^\d{1,4}$/,
  /^(page|p\.?|slide)\s*\d{1,4}(\s*(of|\/)\s*\d{1,4})?$/i,
  /^\d{1,4}\s*(\/|of)\s*\d{1,4}$/i,
  /^-\s*\d{1,4}\s*-$/,
];

function isLetterSpaced(line: string): boolean {
  const parts = line.replace(/\t/g, "   ").trim().split(" ").filter(Boolean);
  if (parts.length < 4) return false;
  const single = parts.filter((p) => [...p].length === 1).length;
  return single / parts.length >= 0.7;
}

/** "W e e k   1" → "Week 1": words are separated by 2+ spaces, letters by one. */
function collapseLetterSpacing(line: string): string {
  return line
    .replace(/\t/g, "   ")
    .trim()
    .split(/ {2,}/)
    .map((w) => w.replace(/ /g, ""))
    .filter(Boolean)
    .join(" ");
}

/**
 * PDF text items split at ligatures ("\tfi\tnd", "F\tASB") come out with a tab
 * inside a word. Join when one side is a 1–2 letter fragment or the next
 * letter is lowercase; otherwise the tab was a column gap.
 */
function fixTabs(line: string): string {
  return line.replace(/(\S*)\t+(?=(\S*))/g, (_m, before: string, after: string) => {
    const b = before.match(/[\p{L}]+$/u)?.[0] ?? "";
    const a = after.match(/^[\p{L}]+/u)?.[0] ?? "";
    if (b && a && (b.length <= 2 || a.length <= 2 || /^\p{Ll}/u.test(a))) return before;
    return `${before} `;
  });
}

export function normalizeLine(raw: string): string {
  let line = isLetterSpaced(raw) ? collapseLetterSpacing(raw) : fixTabs(raw);
  line = line
    .replace(/[ \u00a0]{2,}/g, " ")
    .replace(/([\p{L}\d)\]"”’]) ([,.;:!?])(?=\s|$)/gu, "$1$2")
    // Ligature glyphs extracted as their own word: "Specifi c", "confl ict".
    .replace(/(\p{L})(fi|fl) (\p{Ll})/gu, "$1$2$3")
    .replace(/(\p{L})([’']) s\b/gu, "$1$2s")
    .trim();
  return line;
}

function isPageNumberLine(line: string): boolean {
  return PAGE_NUMBER_PATTERNS.some((re) => re.test(line));
}

/** Key for spotting the same header/footer on many pages (page numbers vary). */
function boilerplateKey(line: string): string {
  return line.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
}

function splitLines(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = normalizeLine(raw);
    if (!line) continue;
    const prev = out[out.length - 1];
    if (prev !== undefined && BULLET_ONLY.test(prev)) {
      out[out.length - 1] = `${prev} ${line}`;
      continue;
    }
    out.push(line);
  }
  if (out.length > 0 && BULLET_ONLY.test(out[out.length - 1])) out.pop();
  return out;
}

export type CleanOptions = {
  /** A line on at least this share of pages (and ≥3 pages) is boilerplate. */
  repeatShare?: number;
};

export function cleanPages(pages: SourcePage[], opts: CleanOptions = {}): SourcePage[] {
  const repeatShare = opts.repeatShare ?? 0.2;
  const split = pages.map((p) => ({ n: p.n, lines: splitLines(p.text ?? "") }));

  const pagesWithKey = new Map<string, number>();
  for (const p of split) {
    const seen = new Set<string>();
    for (const line of p.lines) {
      if (line.length > 160) continue;
      const k = boilerplateKey(line);
      if (seen.has(k)) continue;
      seen.add(k);
      pagesWithKey.set(k, (pagesWithKey.get(k) ?? 0) + 1);
    }
  }
  const threshold = Math.max(3, Math.ceil(split.length * repeatShare));
  const boilerplate = new Set(
    [...pagesWithKey].filter(([k, count]) => count >= threshold && k.length > 0).map(([k]) => k)
  );

  const cleaned = split.map((p) => {
    const seen = new Set<string>();
    const kept: string[] = [];
    for (const line of p.lines) {
      if (isPageNumberLine(line)) continue;
      if (line.length <= 160 && boilerplate.has(boilerplateKey(line))) continue;
      if (line.length >= 12) {
        if (seen.has(line)) continue;
        seen.add(line);
      }
      kept.push(line);
    }
    return { n: p.n, text: kept.join("\n") };
  });
  return dropRepeatedPages(cleaned);
}

function flat(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Build-up slides repeat the previous slide plus one more bullet, and decks
 * sometimes repeat a slide outright. Only the fullest copy keeps its text;
 * the others stay as empty pages so numbering is unchanged.
 */
function dropRepeatedPages(pages: SourcePage[]): SourcePage[] {
  const out = pages.map((p) => ({ ...p }));
  const seen = new Set<string>();
  for (let i = 0; i < out.length; i++) {
    const cur = flat(out[i].text);
    if (cur.length < 30) continue;
    const next = i + 1 < out.length ? flat(out[i + 1].text) : "";
    if (seen.has(cur) || (next.length > cur.length && next.includes(cur))) {
      out[i].text = "";
      continue;
    }
    seen.add(cur);
  }
  return out;
}

/**
 * Plain text (pasted text, transcripts, notes) cut into pseudo-pages of about
 * `wordsPerPage` words at paragraph or sentence boundaries, so budgets and
 * page ranges work the same as for a PDF.
 */
export function paginateText(text: string, wordsPerPage = 500): SourcePage[] {
  const paragraphs = text
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const pieces: string[] = [];
  for (const para of paragraphs) {
    const words = para.split(/\s+/).length;
    if (words <= wordsPerPage) {
      pieces.push(para);
      continue;
    }
    const sentences = para.match(/[^.!?。]+[.!?。]+["')\]]*\s*|[^.!?。]+$/g) ?? [para];
    let buf = "";
    for (const s of sentences) {
      if (buf && (buf + s).split(/\s+/).length > wordsPerPage) {
        pieces.push(buf.trim());
        buf = "";
      }
      buf += s;
    }
    if (buf.trim()) pieces.push(buf.trim());
  }

  const pages: SourcePage[] = [];
  let cur: string[] = [];
  let curWords = 0;
  for (const piece of pieces) {
    const w = piece.split(/\s+/).length;
    if (cur.length > 0 && curWords + w > wordsPerPage) {
      pages.push({ n: pages.length + 1, text: cur.join("\n\n") });
      cur = [];
      curWords = 0;
    }
    cur.push(piece);
    curWords += w;
  }
  if (cur.length > 0) pages.push({ n: pages.length + 1, text: cur.join("\n\n") });
  return pages;
}
