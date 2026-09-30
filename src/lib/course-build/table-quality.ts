/**
 * One check for "is this really a table?", used when tables are extracted,
 * after the writer returns a lesson, and before a lesson renders. A table is
 * a grid of records under a header; text that only looks like one (prose
 * split at wide spaces, diagram labels, repeated fragments) fails and is
 * written back as plain text, so nothing is lost.
 *
 * Every signal is script- and language-agnostic: punctuation, casing where
 * the script has it, repetition and length ratios. No word lists.
 */

export type TableVerdict = { ok: true } | { ok: false; reason: string };

const MIN_BODY_ROWS = 1;
const MAX_COLUMNS = 12;
const MIN_BODY_FILL = 0.5;
const SMALL_TABLE_ROWS = 3;
const SMALL_TABLE_FILL = 0.8;
/** A header cell longer than this is a sentence or a form label, not a column name. */
const MAX_HEADER_CHARS = 60;
const MAX_HEADER_WORDS = 8;
/** Rows whose cells repeat each other: diagram labels picked up twice. */
const MAX_REPEAT_ROW_SHARE = 1 / 3;
/** Rows that read as running text cut into cells. */
const MAX_PROSE_ROW_SHARE = 0.4;
/** One cell holding a paragraph while the rest are scraps. */
const PARAGRAPH_CELL_CHARS = 200;
const PARAGRAPH_CELL_SHARE = 0.5;

const SEPARATOR_ROW = /^\|?(\s*:?-{3,}:?\s*\|)+\s*:?-{0,}:?\s*\|?$/;

/** Cells of one markdown row, with escaped pipes restored. */
function rowCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.replace(/\\\|/g, "|").trim());
}

/** Header + body rows of a markdown table, or null when the lines aren't one. */
export function parseMarkdownTable(markdown: string): string[][] | null {
  const lines = markdown
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2 || !SEPARATOR_ROW.test(lines[1]!.replace(/\s+/g, ""))) return null;
  const rows = [lines[0]!, ...lines.slice(2)].map(rowCells);
  const width = Math.max(...rows.map((r) => r.length));
  return rows.map((r) => [...r, ...new Array<string>(width - r.length).fill("")]);
}

function letters(text: string): number {
  return (text.match(/[\p{L}\p{N}]/gu) ?? []).length;
}

function isNumeric(text: string): boolean {
  return /\d/.test(text) && letters(text.replace(/\d/g, "")) <= 2;
}

/** Word count, with spaceless scripts counted by characters. */
function tokens(text: string): number {
  const spaced = text.split(/\s+/).filter((w) => letters(w) > 0).length;
  const dense = (text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/gu) ?? []).length;
  return Math.max(spaced, Math.ceil(dense / 2));
}

/** Ends where a sentence or clause can't: no closing punctuation, bracket or symbol. */
function endsOpen(text: string): boolean {
  return /[\p{L}\p{N},]$/u.test(text.trim());
}

function startsLower(text: string): boolean {
  return /^\p{Ll}/u.test(text.trim());
}

/** "ribo-" + "nucleases": a word hyphenated across a line break. */
function hyphenBreak(before: string, after: string): boolean {
  return /\p{L}[-\u00ad‐]$/u.test(before.trim()) && /^\p{L}/u.test(after.trim());
}

/** Left cell is several words cut off mid-sentence, right cell carries on in lower case. */
function flowsInto(before: string, after: string): boolean {
  if (!before || !after) return false;
  if (hyphenBreak(before, after)) return true;
  return tokens(before) >= 3 && endsOpen(before) && startsLower(after);
}

/** One cell repeats its neighbour, whole or as its start or end ("ATP | ATP", "Electrons | Electrons carried"). */
function repeatsNeighbour(a: string, b: string): boolean {
  if (letters(a) < 4 || letters(b) < 4 || isNumeric(a) || isNumeric(b)) return false;
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x === y || y.startsWith(`${x} `) || y.endsWith(` ${x}`) || x.startsWith(`${y} `) || x.endsWith(` ${y}`);
}

/** The row read left to right as one line. */
function rowLine(row: string[]): string {
  return row.filter(Boolean).join(" ");
}

function firstFilled(row: string[]): string {
  return row.find(Boolean) ?? "";
}

/**
 * Whether `grid` (header row first) is a real table. Fails closed: when in
 * doubt it says no, and callers fall back to plain text.
 */
export function judgeTable(grid: string[][]): TableVerdict {
  const rows = grid.map((r) => r.map((c) => c.replace(/\s+/g, " ").trim()));
  const cols = Math.max(0, ...rows.map((r) => r.length));
  if (cols < 2 || cols > MAX_COLUMNS) return { ok: false, reason: "columns" };
  const header = rows[0] ?? [];
  const body = rows.slice(1).filter((r) => r.some(Boolean));
  if (body.length < MIN_BODY_ROWS) return { ok: false, reason: "rows" };

  const headerCells = header.filter(Boolean);
  if (headerCells.length === 0 || headerCells.some((c) => c.length > MAX_HEADER_CHARS || tokens(c) > MAX_HEADER_WORDS)) {
    return { ok: false, reason: "header" };
  }

  // A column name doesn't carry on into the first record like a wrapped sentence or label,
  // even past blank cells when text laid out in columns was read as rows.
  const firstBelow = (j: number) => body.find((r) => r[j])?.[j] ?? "";
  if (header.some((c, j) => flowsInto(c, firstBelow(j)))) return { ok: false, reason: "header" };

  const filled = body.reduce((n, r) => n + r.filter(Boolean).length, 0);
  // With few records there is little evidence, so they must be nearly complete.
  const minFill = body.length <= SMALL_TABLE_ROWS ? SMALL_TABLE_FILL : MIN_BODY_FILL;
  if (filled < body.length * cols * minFill) return { ok: false, reason: "sparse" };
  // Every record holds at least two fields; a lone cell per row is a list.
  if (body.filter((r) => r.filter(Boolean).length >= 2).length < body.length * 0.75) {
    return { ok: false, reason: "sparse" };
  }

  const all = rows.flat().filter(Boolean);
  const total = all.reduce((n, c) => n + c.length, 0);
  const longest = Math.max(...all.map((c) => c.length));
  if (longest >= PARAGRAPH_CELL_CHARS && longest >= total * PARAGRAPH_CELL_SHARE) return { ok: false, reason: "paragraph" };

  const repeatRows = rows.filter((r) => r.some((c, i) => i > 0 && repeatsNeighbour(r[i - 1]!, c))).length;
  const seen = new Set<string>();
  let dupRows = 0;
  for (const r of rows) {
    const key = r.join("\u0000").toLowerCase();
    if (seen.has(key)) dupRows++;
    seen.add(key);
  }
  if (repeatRows + dupRows >= Math.max(1, rows.length * MAX_REPEAT_ROW_SHARE)) return { ok: false, reason: "repeated" };
  // A running page header ("276 | CHAPTER 8 | …") picked up on every line: a
  // column whose every record just repeats its header is no column at all.
  if (header.some((h, j) => h && body.every((r) => (r[j] ?? "").toLowerCase() === h.toLowerCase()))) {
    return { ok: false, reason: "repeated" };
  }

  // Running text split into cells: a cell stops mid-sentence and the next one
  // carries straight on, and the row as a line runs on into the next row.
  let proseRows = 0;
  let hyphenated = 0;
  rows.forEach((r, i) => {
    const across = r.some((c, j) => j > 0 && flowsInto(r[j - 1]!, c));
    const next = rows[i + 1];
    const prev = rows[i - 1];
    const wraps =
      (next != null && flowsInto(rowLine(r), firstFilled(next))) ||
      (prev != null && flowsInto(rowLine(prev), firstFilled(r)));
    if (across && wraps) proseRows++;
    if (next && r.some((c, j) => hyphenBreak(c, next[j] ?? "")) ) hyphenated++;
    if (r.some((c, j) => j > 0 && hyphenBreak(r[j - 1]!, c))) hyphenated++;
  });
  if (proseRows >= Math.max(2, rows.length * MAX_PROSE_ROW_SHARE)) return { ok: false, reason: "prose" };
  if (hyphenated >= 2) return { ok: false, reason: "prose" };

  return { ok: true };
}

/**
 * A rejected table as plain lines: one line per row, cells joined by spaces
 * (which puts split sentences back together) and a cell that only repeats
 * its neighbour dropped.
 */
export function tableAsText(grid: string[][]): string {
  return grid
    .map((r) => {
      const out: string[] = [];
      for (const c of r.map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean)) {
        const prev = out[out.length - 1];
        if (prev && prev.toLowerCase() === c.toLowerCase()) continue;
        out.push(c);
      }
      return out.join(" ");
    })
    .filter(Boolean)
    .join("\n");
}

function isTableRow(line: string): boolean {
  return /^\|.*\|$/.test(line.trim());
}

/** Runs of table rows outside fenced code, header first; a missing `|---|` line is added. */
export function markdownTableBlocks(markdown: string): string[] {
  const out: string[] = [];
  let fenced = false;
  let run: string[] = [];
  const flush = () => {
    if (run.length >= 2) {
      const sep = SEPARATOR_ROW.test(run[1]!.replace(/\s+/g, ""));
      out.push(sep ? run.join("\n") : [run[0]!, `|${" --- |".repeat(rowCells(run[0]!).length)}`, ...run.slice(1)].join("\n"));
    }
    run = [];
  };
  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      flush();
      fenced = !fenced;
    } else if (!fenced && isTableRow(line)) run.push(line.trim());
    else flush();
  }
  flush();
  return out;
}

/** The first table in `markdown` that passes `judgeTable`, or null. */
export function firstRealTable(markdown: string): string | null {
  for (const block of markdownTableBlocks(markdown)) {
    const grid = parseMarkdownTable(block);
    if (grid && judgeTable(grid).ok) return block;
  }
  return null;
}

/**
 * Every markdown table in `markdown` that fails `judgeTable` (or every table,
 * with `all`) becomes plain text. Tables inside fenced code are left alone,
 * and so is a table the text ends on when `streaming` (it may still be
 * arriving row by row).
 */
export function guardMarkdownTables(
  markdown: string,
  opts: { streaming?: boolean; all?: boolean } = {}
): { text: string; rejected: number } {
  const lines = markdown.split("\n");
  const out: string[] = [];
  let rejected = 0;
  let fenced = false;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (fenced || !isTableRow(line)) {
      out.push(line);
      i++;
      continue;
    }
    let j = i;
    while (j < lines.length && isTableRow(lines[j]!)) j++;
    const block = lines.slice(i, j);
    const trailing = opts.streaming && lines.slice(j).every((l) => !l.trim());
    const parsed = trailing ? null : parseMarkdownTable(block.join("\n"));
    // A header with no rows yet says nothing either way.
    const grid = parsed && parsed.slice(1).some((r) => r.some(Boolean)) ? parsed : null;
    if (grid && (opts.all || !judgeTable(grid).ok)) {
      rejected++;
      const indent = line.match(/^\s*/)?.[0] ?? "";
      out.push(...tableAsText(grid).split("\n").map((l) => `${indent}${l}`));
    } else {
      out.push(...block);
    }
    i = j;
  }
  return { text: rejected ? out.join("\n") : markdown, rejected };
}
