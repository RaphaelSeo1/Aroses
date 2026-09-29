/**
 * Every source table must appear in the course exactly. Tables extracted as
 * markdown are matched against the tables the writer produced: a close copy
 * is replaced with the exact source table, and a missing one is inserted
 * into the lesson that teaches its page.
 */
import { isTableLine } from "./pdf-layout.ts";
import { matchTokens } from "./language.ts";

/** Markdown tables in `text`, each as its exact lines (header, separator, rows). */
export function markdownTables(text: string): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  const flush = () => {
    if (cur.length >= 3 && /^\|(\s*:?-{3,}:?\s*\|)+$/.test(cur[1]!.replace(/\s+/g, " ").replace(/ /g, ""))) {
      out.push(cur.join("\n"));
    }
    cur = [];
  };
  for (const line of text.split("\n")) {
    if (isTableLine(line)) cur.push(line.trim());
    else flush();
  }
  flush();
  return out;
}

function cellsOf(table: string): string[] {
  return table
    .split("\n")
    .filter((_, i) => i !== 1)
    .flatMap((row) => row.replace(/^\||\|$/g, "").split(/(?<!\\)\|/))
    .map(normCell)
    .filter(Boolean);
}

function normCell(cell: string): string {
  return cell
    .replace(/\\\|/g, "|")
    .replace(/[*_`]/g, "")
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function numericCells(cells: string[]): string[] {
  return cells.filter((c) => /\d/.test(c));
}

/** Share of the source table's cells present in `candidate`. */
function overlap(sourceCells: string[], candidate: string, converting: boolean): number {
  const src = converting ? numericCells(sourceCells) : sourceCells;
  if (src.length === 0) return 0;
  const have = new Set(cellsOf(candidate));
  return src.filter((c) => have.has(c)).length / src.length;
}

const MATCH = 0.5;

export type TableLesson = { content: string; firstPage: number; lastPage: number };

export type TableFix = { page: number; action: "replaced" | "inserted" };

/** Index of the lesson that teaches page `g`: the one whose range holds it, else the nearest. */
function lessonFor(lessons: TableLesson[], g: number): number {
  let best = 0;
  let bestDist = Infinity;
  lessons.forEach((l, i) => {
    const lo = l.firstPage > 0 ? l.firstPage : Infinity;
    const hi = l.lastPage > 0 ? l.lastPage : lo;
    const dist = g >= lo && g <= hi ? 0 : Math.min(Math.abs(g - lo), Math.abs(g - hi));
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  });
  return best;
}

/** Puts the table after the paragraph that shares the most words with it, else at the end. */
function insertTable(content: string, table: string): string {
  const blocks = content.split(/\n{2,}/);
  const want = new Set(matchTokens(table));
  let best = -1;
  let bestScore = 1;
  blocks.forEach((b, i) => {
    if (b.trim().startsWith("|") || b.trim().startsWith("[figure")) return;
    const score = matchTokens(b).filter((t) => want.has(t)).length;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  if (best < 0) return `${content.trimEnd()}\n\n${table}`;
  blocks.splice(best + 1, 0, table);
  return blocks.join("\n\n");
}

/**
 * Makes every table on `pages` appear in `lessons` exactly (when converting,
 * the writer's translated table is kept if its numbers match). Returns what changed.
 */
export function ensureTables(
  lessons: TableLesson[],
  pages: Array<{ g: number; text: string }>,
  opts: { converting?: boolean } = {}
): TableFix[] {
  const fixes: TableFix[] = [];
  if (lessons.length === 0) return fixes;
  for (const page of pages) {
    for (const table of markdownTables(page.text)) {
      const cells = cellsOf(table);
      let found: { lesson: number; table: string; score: number } | null = null;
      lessons.forEach((l, i) => {
        for (const t of markdownTables(l.content)) {
          const score = overlap(cells, t, !!opts.converting);
          if (score >= MATCH && (!found || score > found.score)) found = { lesson: i, table: t, score };
        }
      });
      const hit = found as { lesson: number; table: string; score: number } | null;
      if (hit) {
        if (opts.converting) continue;
        const exact = cellsOf(hit.table).join("\u0000") === cells.join("\u0000");
        if (!exact) {
          lessons[hit.lesson]!.content = lessons[hit.lesson]!.content.replace(hit.table, table);
          fixes.push({ page: page.g, action: "replaced" });
        }
        continue;
      }
      const i = lessonFor(lessons, page.g);
      lessons[i]!.content = insertTable(lessons[i]!.content, table);
      fixes.push({ page: page.g, action: "inserted" });
    }
  }
  return fixes;
}
