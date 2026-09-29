/**
 * Page text from positioned PDF text items, with tables rebuilt as markdown.
 * Plain text keeps the PDF's reading order; a block of rows whose cells line
 * up in the same columns becomes one pipe table, so the writer sees every
 * row and column instead of the cells run together.
 *
 * A block only becomes a table when its geometry says so (every column's
 * cells share a left edge, right edge or centre) and its content reads as
 * records (`judgeTable`). Text drawn over a picture is the picture's
 * labelling: it never forms a table and is kept together on one line.
 */
import { judgeTable } from "./table-quality.ts";

export type TextItem = {
  str: string;
  x: number;
  /** Baseline, PDF units (up is larger). */
  y: number;
  width: number;
  fontSize: number;
};

/** Axis-aligned rectangle in PDF units. */
export type Rect = { x0: number; y0: number; x1: number; y1: number };

export type PageLayout = {
  /** Picture areas on the page; text inside them is figure labelling. */
  figures?: Rect[];
  /** The page box; running headers and footers sit in its top and bottom margins. */
  page?: Rect;
};

/** Share of the page height at the top and bottom where headers, footers and page numbers sit. */
const MARGIN_BAND = 0.05;

type Cell = { text: string; x0: number; x1: number };
type Row = { y: number; fontSize: number; cells: Cell[]; items: number[] };

/** Items closer than this (× font size) belong to the same word. */
const JOIN_GAP = 0.15;
/** A gap wider than this (× font size) starts a new cell. */
const CELL_GAP = 1.0;
/** Share of the smaller glyph box two items must share vertically to be one line. */
const LINE_OVERLAP = 0.5;
const MIN_TABLE_ROWS = 3;
/** Longer average cells read as side-by-side prose columns, not a table. */
const MAX_AVG_CELL_CHARS = 40;
/** A column's cells may drift this far (× font size) from a shared edge or centre. */
const ALIGN_TOLERANCE = 1.0;

function joinText(a: string, b: string, gap: number, fontSize: number): string {
  if (!a) return b;
  if (gap <= fontSize * JOIN_GAP || a.endsWith(" ") || b.startsWith(" ")) return a + b;
  return `${a} ${b}`;
}

/** Vertical extent of an item's glyphs, from a little below the baseline to about cap height. */
function extent(it: TextItem): [number, number] {
  return [it.y - it.fontSize * 0.25, it.y + it.fontSize * 0.75];
}

/**
 * One visual line when the glyph boxes overlap for most of the smaller one.
 * Scale-free: tiny labels a line apart stay apart, uneven handwriting and
 * raised or lowered script stay together.
 */
function sameLine(a: TextItem, b: TextItem): boolean {
  const [a0, a1] = extent(a);
  const [b0, b1] = extent(b);
  const overlap = Math.min(a1, b1) - Math.max(a0, b0);
  return overlap >= Math.min(a1 - a0, b1 - b0) * LINE_OVERLAP;
}

/**
 * Drops text drawn twice in the same place (shadows, fake bold, a PDF that
 * paints the same run on two layers), which would otherwise read "TotalTotal".
 */
export function dropOverprintedItems(items: TextItem[]): TextItem[] {
  const kept: TextItem[] = [];
  const byKey = new Map<string, TextItem[]>();
  for (const it of items) {
    const s = it.str.trim();
    if (!s) {
      kept.push(it);
      continue;
    }
    const same = byKey.get(s) ?? [];
    const tol = Math.max(0.5, it.fontSize * 0.2);
    if (same.some((o) => Math.abs(o.x - it.x) <= tol && Math.abs(o.y - it.y) <= tol)) continue;
    same.push(it);
    byKey.set(s, same);
    kept.push(it);
  }
  return kept;
}

/** An item holding two cells ("most valuable bundle  income and prices") splits at the wide space. */
function splitWideSpaces(it: TextItem): Array<TextItem & { newCell?: boolean }> {
  if (!/\S\s{2,}\S/.test(it.str)) return [it];
  const chars = [...it.str].length;
  const perChar = it.width / Math.max(1, chars);
  const out: Array<TextItem & { newCell?: boolean }> = [];
  const re = /\S+(?: \S+)*/g;
  for (let m = re.exec(it.str); m; m = re.exec(it.str)) {
    const at = [...it.str.slice(0, m.index)].length;
    out.push({ ...it, str: m[0], x: it.x + at * perChar, width: [...m[0]].length * perChar, newCell: out.length > 0 });
  }
  return out;
}

/** Groups items into visual rows (top to bottom) and splits each row into cells at wide gaps. */
function rowsOf(items: TextItem[], include: (i: number) => boolean): Row[] {
  const order = items
    .flatMap((it, i) => (include(i) ? splitWideSpaces(it).map((piece) => ({ it: piece, i })) : []))
    .filter(({ it }) => it.str.trim() !== "")
    .sort((a, b) => b.it.y - a.it.y || a.it.x - b.it.x);
  const rows: Array<{ y: number; members: Array<{ it: TextItem & { newCell?: boolean }; i: number }> }> = [];
  for (const m of order) {
    const row = rows.find((r) => sameLine(r.members[0]!.it, m.it));
    if (row) row.members.push(m);
    else rows.push({ y: m.it.y, members: [m] });
  }
  return rows.map((r) => {
    const members = r.members.sort((a, b) => a.it.x - b.it.x);
    const fontSize = Math.max(...members.map((m) => m.it.fontSize));
    const cells: Cell[] = [];
    let cur: Cell | null = null;
    for (const { it } of members) {
      const x1 = it.x + Math.max(0, it.width);
      if (cur && !it.newCell && it.x - cur.x1 <= fontSize * CELL_GAP) {
        cur.text = joinText(cur.text, it.str, it.x - cur.x1, fontSize);
        cur.x1 = Math.max(cur.x1, x1);
      } else {
        cur = { text: it.str, x0: it.x, x1 };
        cells.push(cur);
      }
    }
    for (const c of cells) c.text = c.text.replace(/\s+/g, " ").trim();
    return { y: r.y, fontSize, cells: cells.filter((c) => c.text), items: members.map((m) => m.i) };
  });
}

type Interval = { x0: number; x1: number };

/** Column spans: the union of overlapping cell spans across the block's rows. */
function columnsOf(rows: Row[]): Interval[] {
  const spans = rows.flatMap((r) => r.cells.map((c) => ({ x0: c.x0, x1: c.x1 }))).sort((a, b) => a.x0 - b.x0);
  const cols: Interval[] = [];
  for (const s of spans) {
    const last = cols[cols.length - 1];
    if (last && s.x0 <= last.x1) last.x1 = Math.max(last.x1, s.x1);
    else cols.push({ ...s });
  }
  return cols;
}

function columnIndex(cols: Interval[], c: Cell): number {
  let best = 0;
  let bestOverlap = -Infinity;
  cols.forEach((col, i) => {
    const overlap = Math.min(col.x1, c.x1) - Math.max(col.x0, c.x0);
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      best = i;
    }
  });
  return best;
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|");
}

const MAX_COLUMNS = 12;
const MIN_FILLED = 0.7;

/** A word or a number, not a stray glyph. */
function isRealCell(text: string): boolean {
  return (text.match(/[\p{L}\p{N}]/gu) ?? []).length >= 2 || /^[\p{N}\p{Lo}]$/u.test(text);
}

function hasNumber(text: string): boolean {
  return /\d/.test(text);
}

/** Most values that fit in one window of width `tol`. */
function mostWithin(values: number[], tol: number): number {
  const v = values.slice().sort((a, b) => a - b);
  let best = 0;
  for (let i = 0, j = 0; j < v.length; j++) {
    while (v[j]! - v[i]! > tol) i++;
    best = Math.max(best, j - i + 1);
  }
  return best;
}

/**
 * Every column's body cells share a left edge, a right edge or a centre, as
 * a table's do (one cell per column may stand out, like an indented total).
 * Prose split at wide word gaps and labels scattered over a chart line up
 * only by chance.
 */
function columnsAligned(firstLines: Array<Array<Cell | undefined>>, fontSize: number): boolean {
  const cols = firstLines[0]?.length ?? 0;
  const tol = fontSize * ALIGN_TOLERANCE;
  for (let c = 0; c < cols; c++) {
    const cells = firstLines.map((r) => r[c]).filter((x): x is Cell => x != null);
    if (cells.length < 2) continue;
    const need = cells.length <= 3 ? cells.length : cells.length - 1;
    const fit = Math.max(
      mostWithin(cells.map((x) => x.x0), tol),
      mostWithin(cells.map((x) => x.x1), tol),
      mostWithin(cells.map((x) => (x.x0 + x.x1) / 2), tol)
    );
    if (fit < need) return false;
  }
  return true;
}

/** Markdown for a block of rows, or null when it doesn't read as a table. */
function tableFrom(block: Row[]): string | null {
  const cols = columnsOf(block);
  if (cols.length < 2 || cols.length > MAX_COLUMNS) return null;
  const grid: string[][] = [];
  // Where each cell's first line sits, for the alignment check.
  const firstLines: Array<Array<Cell | undefined>> = [];
  for (const row of block) {
    const cells = new Array<string>(cols.length).fill("");
    const geo = new Array<Cell | undefined>(cols.length).fill(undefined);
    for (const c of row.cells) {
      const i = columnIndex(cols, c);
      cells[i] = cells[i] ? `${cells[i]} ${c.text}` : c.text;
      geo[i] = geo[i] ? { text: "", x0: geo[i]!.x0, x1: c.x1 } : c;
    }
    const prev = grid[grid.length - 1];
    // A wrapped cell continues on a line of its own with the first column empty.
    const filled = cells.filter(Boolean).length;
    if (prev && !cells[0] && filled < cols.length && filled <= Math.ceil(cols.length / 2)) {
      cells.forEach((t, i) => {
        if (t) prev[i] = prev[i] ? `${prev[i]} ${t}` : t;
      });
      continue;
    }
    grid.push(cells);
    firstLines.push(geo);
  }
  if (grid.length < MIN_TABLE_ROWS) return null;
  const all = grid.flat().filter(Boolean);
  const avg = all.reduce((n, t) => n + t.length, 0) / Math.max(1, all.length);
  if (avg > MAX_AVG_CELL_CHARS) return null;
  // Scattered marks (handwriting, arrows, diagram labels) leave most cells empty or near-empty.
  if (all.length < grid.length * cols.length * MIN_FILLED) return null;
  if (all.filter(isRealCell).length < all.length * MIN_FILLED) return null;
  const multi = grid.filter((r) => r.filter(Boolean).length >= 2).length;
  if (multi < grid.length - 1) return null;
  if (cols.length === 2) {
    // Two columns of words is also what side-by-side bullet lists look like.
    const numeric = grid.filter((r) => r.some(hasNumber)).length;
    const shortFirst = grid.every((r) => r[0]!.length <= 25);
    if (numeric < grid.length / 2 && !shortFirst) return null;
  }
  const fontSize = Math.min(...block.map((r) => r.fontSize));
  // The header may be centred over its column or span two; alignment is judged on the records.
  if (!columnsAligned(firstLines.slice(1), fontSize)) return null;
  if (!judgeTable(grid).ok) return null;
  const line = (cells: string[]) => `| ${cells.map(escapeCell).join(" | ")} |`;
  return [line(grid[0]!), `|${cols.map(() => " --- ").join("|")}|`, ...grid.slice(1).map(line)].join("\n");
}

type Table = { markdown: string; items: Set<number> };

/** Blocks of consecutive, evenly spaced rows that each hold several cells. */
function findTables(rows: Row[]): Table[] {
  const tables: Table[] = [];
  let i = 0;
  while (i < rows.length) {
    if (rows[i]!.cells.length < 2) {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < rows.length) {
      const prev = rows[j - 1]!;
      const cur = rows[j]!;
      const gap = prev.y - cur.y;
      if (gap > Math.max(prev.fontSize, cur.fontSize) * 2.6) break;
      // A single-cell line inside the block is either a wrapped cell or the end of the table.
      if (cur.cells.length < 2 && !(j + 1 < rows.length && rows[j + 1]!.cells.length >= 2)) break;
      j++;
    }
    const block = rows.slice(i, j);
    const md = block.length >= MIN_TABLE_ROWS ? tableFrom(block) : null;
    if (md) {
      tables.push({ markdown: md, items: new Set(block.flatMap((r) => r.items)) });
      i = j;
    } else {
      i++;
    }
  }
  return tables;
}

function inside(r: Rect, x: number, y: number): boolean {
  return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
}

/** Index of the figure whose area holds the item's centre, or -1. */
function figureOf(it: TextItem, figures: Rect[]): number {
  const cx = it.x + Math.max(0, it.width) / 2;
  const cy = it.y + it.fontSize * 0.3;
  return figures.findIndex((f) => inside(f, cx, cy));
}

/**
 * Text for one page. Items outside tables come out in the PDF's own order
 * (as the rest of the app extracts them); each table is written once, where
 * its first item appears, and each figure's labels once, on one line.
 */
export function layoutPageText(rawItems: TextItem[], layout: PageLayout = {}): string {
  const items = dropOverprintedItems(rawItems);
  const figures = layout.figures ?? [];
  const figureIndex = items.map((it) => (figures.length && it.str.trim() ? figureOf(it, figures) : -1));
  const page = layout.page;
  const band = page ? (page.y1 - page.y0) * MARGIN_BAND : 0;
  // Page chrome in the margins is never part of a table.
  const inMargin = (it: TextItem) =>
    page != null &&
    band > 0 &&
    ((it.y > page.y1 - band && it.y <= page.y1) || (it.y < page.y0 + band && it.y >= page.y0));
  const tables = findTables(rowsOf(items, (i) => figureIndex[i]! < 0 && !inMargin(items[i]!)));
  const tableOf = new Map<number, Table>();
  for (const t of tables) for (const i of t.items) tableOf.set(i, t);
  const written = new Set<Table>();
  const labelsWritten = new Set<number>();

  const labelLine = (f: number): string =>
    rowsOf(items, (i) => figureIndex[i] === f)
      .flatMap((r) => r.cells.map((c) => c.text))
      .join(" · ");

  let text = "";
  let last: TextItem | null = null;
  items.forEach((it, i) => {
    if (!it.str) return;
    const f = figureIndex[i]!;
    if (f >= 0) {
      if (!labelsWritten.has(f)) {
        labelsWritten.add(f);
        const labels = labelLine(f);
        if (labels) text += `${text && !text.endsWith("\n") ? "\n" : ""}${labels}\n`;
      }
      last = null;
      return;
    }
    const t = tableOf.get(i);
    if (t) {
      if (!written.has(t)) {
        written.add(t);
        text += `${text && !text.endsWith("\n") ? "\n" : ""}${t.markdown}\n`;
      }
      last = null;
      return;
    }
    if (!last) {
      text += text && !text.endsWith("\n") ? `\n${it.str}` : it.str;
    } else if (!sameLine(last, it)) {
      text += `\n${it.str}`;
    } else if (it.x < last.x) {
      // Drawn out of reading order (a run placed back before the previous one): never glue.
      text += /\s$/.test(text) || it.str.startsWith(" ") ? it.str : ` ${it.str}`;
    } else {
      const gap = it.x - (last.x + Math.max(0, last.width));
      if (gap > it.fontSize * CELL_GAP * 1.5) text += `\t${it.str}`;
      else text = joinText(text, it.str, gap, it.fontSize);
    }
    last = it;
  });
  return text.trim();
}

/** True for a markdown table line, which cleanup must leave exactly as extracted. */
export function isTableLine(line: string): boolean {
  return /^\|.*\|$/.test(line.trim());
}
