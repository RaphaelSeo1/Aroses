/**
 * Page text from positioned PDF text items, with tables rebuilt as markdown.
 * Plain text keeps the PDF's reading order; a block of rows whose cells line
 * up in the same columns becomes one pipe table, so the writer sees every
 * row and column instead of the cells run together.
 */

export type TextItem = {
  str: string;
  x: number;
  /** Baseline, PDF units (up is larger). */
  y: number;
  width: number;
  fontSize: number;
};

type Cell = { text: string; x0: number; x1: number };
type Row = { y: number; fontSize: number; cells: Cell[]; items: number[] };

/** Items closer than this (× font size) belong to the same word. */
const JOIN_GAP = 0.15;
/** A gap wider than this (× font size) starts a new cell. */
const CELL_GAP = 1.0;
const MIN_TABLE_ROWS = 3;
/** Longer average cells read as side-by-side prose columns, not a table. */
const MAX_AVG_CELL_CHARS = 40;

function joinText(a: string, b: string, gap: number, fontSize: number): string {
  if (!a) return b;
  if (gap <= fontSize * JOIN_GAP || a.endsWith(" ") || b.startsWith(" ")) return a + b;
  return `${a} ${b}`;
}

function sameLine(a: TextItem, b: TextItem): boolean {
  return Math.abs(a.y - b.y) <= Math.max(2, Math.min(a.fontSize, b.fontSize) * 0.4);
}

/** Groups items into visual rows (top to bottom) and splits each row into cells at wide gaps. */
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

function rowsOf(items: TextItem[]): Row[] {
  const order = items
    .flatMap((it, i) => splitWideSpaces(it).map((piece) => ({ it: piece, i })))
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

/** Markdown for a block of rows, or null when it doesn't read as a table. */
function tableFrom(block: Row[]): string | null {
  const cols = columnsOf(block);
  if (cols.length < 2) return null;
  const grid: string[][] = [];
  for (const row of block) {
    const cells = new Array<string>(cols.length).fill("");
    for (const c of row.cells) {
      const i = columnIndex(cols, c);
      cells[i] = cells[i] ? `${cells[i]} ${c.text}` : c.text;
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
  }
  if (grid.length < MIN_TABLE_ROWS || cols.length > MAX_COLUMNS) return null;
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

/**
 * Text for one page. Items outside tables come out in the PDF's own order
 * (as the rest of the app extracts them); each table is written once, where
 * its first item appears.
 */
export function layoutPageText(items: TextItem[]): string {
  const tables = findTables(rowsOf(items));
  const tableOf = new Map<number, Table>();
  for (const t of tables) for (const i of t.items) tableOf.set(i, t);
  const written = new Set<Table>();

  let text = "";
  let last: TextItem | null = null;
  items.forEach((it, i) => {
    if (!it.str) return;
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
      text += it.str;
    } else if (!sameLine(last, it)) {
      text += `\n${it.str}`;
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
