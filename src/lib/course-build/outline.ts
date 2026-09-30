import type { SourcePage } from "./clean.ts";
import { contentLength } from "./language.ts";
import { isQuestionPage, isReferencePage, namedLists } from "./page-signals.ts";

/** A page addressed by its position across every source in the build (1-based). */
export type BuildPage = {
  g: number;
  sourceIndex: number;
  /** Page / slide / pseudo-page number inside its own source. */
  n: number;
  text: string;
};

export type BuildSourceInfo = {
  index: number;
  label: string;
  kind: string;
  pages: SourcePage[];
};

export function numberPages(sources: BuildSourceInfo[]): BuildPage[] {
  const out: BuildPage[] = [];
  for (const s of sources) {
    for (const p of s.pages) out.push({ g: out.length + 1, sourceIndex: s.index, n: p.n, text: p.text });
  }
  return out;
}

const NUMBER_TOKEN = /(?<![\p{L}])[-(]?\$?\d[\d,]*(\.\d+)?%?\)?(?![\p{L}])/gu;

/** Several lines each holding two or more numbers, or a pipe table. */
export function looksLikeTable(text: string): boolean {
  const lines = text.split("\n");
  if (lines.filter((l) => (l.match(/\|/g) ?? []).length >= 2).length >= 3) return true;
  let numericRows = 0;
  let numbers = 0;
  let nonEmpty = 0;
  for (const l of lines) {
    if (!l.trim()) continue;
    nonEmpty += 1;
    const n = (l.match(NUMBER_TOKEN) ?? []).length;
    numbers += n;
    if (n >= 2) numericRows += 1;
  }
  return numericRows >= 4 && numbers >= 10 && numericRows / Math.max(1, nonEmpty) >= 0.3;
}

const FIGURE_REF =
  /\b(fig(ure|ura)?\.?\s*\d+|table\s+\d+|tabla\s+\d+|tableau\s+\d+|tabelle\s+\d+|abbildung\s+\d+|abb\.\s*\d+|tabella\s+\d+|tabela\s+\d+)|(표|그림|図|表|图|圖)\s*\d+/iu;

export function mentionsFigure(text: string): boolean {
  return FIGURE_REF.test(text);
}

/**
 * Share of the per-page output budget a page earns. Empty pages earn none,
 * thin ones half, dense prose or a page laying out a list of named items
 * one and a half (every item needs its own sentences), tables double.
 * Length is in Latin-character equivalents, so a dense Chinese page weighs
 * like a dense English one.
 */
export function pageWeight(text: string): number {
  const chars = contentLength(text.replace(/\s+/g, " ").trim());
  if (chars < 25) return 0;
  if (chars < 120) return 0.5;
  if (looksLikeTable(text)) return 2;
  return chars > 1_800 || namedLists(text).length > 0 ? 1.5 : 1;
}

function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

/**
 * One short line per page for the planner: heading, first line, and markers.
 * `[T]` table, `[F]` figure reference, `[·]` nearly empty, `[Q]` only asks
 * a question, `[R]` reference list.
 */
export function compactOutline(pages: BuildPage[], sources: BuildSourceInfo[]): string {
  const out: string[] = [];
  let lastSource = -1;
  for (const p of pages) {
    if (p.sourceIndex !== lastSource && sources.length > 1) {
      const s = sources.find((x) => x.index === p.sourceIndex);
      out.push(`== ${s?.label ?? `Source ${p.sourceIndex + 1}`} (${s?.kind ?? "file"}) ==`);
    }
    lastSource = p.sourceIndex;
    const lines = p.text.split("\n").filter(Boolean);
    const chars = p.text.length;
    const marks = [
      chars < 25 ? "·" : "",
      looksLikeTable(p.text) ? "T" : "",
      mentionsFigure(p.text) ? "F" : "",
      isQuestionPage(p.text) ? "Q" : "",
      isReferencePage(p.text) ? "R" : "",
    ]
      .filter(Boolean)
      .map((m) => `[${m}]`)
      .join("");
    const head = clip(lines[0] ?? "", 70);
    const next = clip(lines.slice(1).join(" "), 80);
    out.push(`p${p.g}${marks ? ` ${marks}` : ""} ${head}${next ? ` | ${next}` : ""}`);
  }
  return out.join("\n");
}
