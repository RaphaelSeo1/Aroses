/**
 * Slide and document text that keeps paragraphs apart and turns tables into
 * markdown, so a table in a .pptx or .docx reaches the writer row by row.
 */
import { XMLParser } from "fast-xml-parser";
import { judgeTable, tableAsText } from "./table-quality.ts";

type OrderedNode = Record<string, unknown>;

const ordered = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  preserveOrder: true,
  trimValues: false,
});

function tagOf(node: OrderedNode): string | null {
  for (const k of Object.keys(node)) if (k !== ":@") return k;
  return null;
}

function childrenOf(node: OrderedNode, tag: string): OrderedNode[] {
  const v = node[tag];
  return Array.isArray(v) ? (v as OrderedNode[]) : [];
}

/** All run text under a node, in order. */
function textOf(nodes: OrderedNode[]): string {
  let out = "";
  for (const n of nodes) {
    const tag = tagOf(n);
    if (!tag) continue;
    if (tag === "#text") out += String(n["#text"] ?? "");
    else if (tag === "br") out += " ";
    else out += textOf(childrenOf(n, tag));
  }
  return out;
}

function cell(text: string): string {
  return text.replace(/\s+/g, " ").trim().replace(/\|/g, "\\|");
}

export function markdownTable(rows: string[][]): string {
  const width = Math.max(...rows.map((r) => r.length));
  const pad = (r: string[]) => [...r, ...new Array<string>(width - r.length).fill("")];
  const line = (r: string[]) => `| ${pad(r).map(cell).join(" | ")} |`;
  return [line(rows[0]!), `|${new Array(width).fill(" --- ").join("|")}|`, ...rows.slice(1).map(line)].join("\n");
}

function tableRows(tbl: OrderedNode[]): string[][] {
  const rows: string[][] = [];
  for (const tr of tbl) {
    if (tagOf(tr) !== "tr") continue;
    const cells = childrenOf(tr, "tr")
      .filter((tc) => tagOf(tc) === "tc")
      .map((tc) => textOf(childrenOf(tc, "tc")));
    if (cells.some((c) => c.trim())) rows.push(cells);
  }
  return rows;
}

function walkSlide(nodes: OrderedNode[], out: string[]): void {
  for (const n of nodes) {
    const tag = tagOf(n);
    if (!tag || tag === "#text") continue;
    const kids = childrenOf(n, tag);
    if (tag === "tbl") {
      const rows = tableRows(kids);
      // Slides often use a table only to lay out text; that stays plain lines.
      if (rows.length > 0 && judgeTable(rows).ok) out.push(markdownTable(rows));
      else out.push(...tableAsText(rows).split("\n").filter(Boolean));
    } else if (tag === "p") {
      const t = textOf(kids).replace(/\s+/g, " ").trim();
      if (t) out.push(t);
    } else {
      walkSlide(kids, out);
    }
  }
}

/** One slide's (or notes page's) XML as lines, tables as markdown. */
export function slideXmlToText(xml: string): string {
  const out: string[] = [];
  walkSlide(ordered.parse(xml) as OrderedNode[], out);
  return out.join("\n");
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decode(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const code = e[1]?.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    });
}

/** mammoth's HTML for a .docx as plain paragraphs, tables as markdown. */
export function docxHtmlToText(html: string): string {
  const withTables = html.replace(/<table[\s\S]*?<\/table>/gi, (table) => {
    const rows = [...table.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((tr) =>
      [...tr[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((td) =>
        decode(td[1]!.replace(/<\/p>\s*<p[^>]*>/gi, " "))
      )
    );
    const kept = rows.filter((r) => r.some((c) => c.trim()));
    if (!kept.length) return "";
    if (judgeTable(kept).ok) return `\n\n${markdownTable(kept)}\n\n`;
    return `\n\n${tableAsText(kept).split("\n").join("\n\n")}\n\n`;
  });
  return withTables
    .replace(/<\/(p|h[1-6]|li)>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .split(/\n{2,}/)
    .map((block) => (block.trim().startsWith("|") ? block.trim() : decode(block).replace(/[ \t]+/g, " ").trim()))
    .filter(Boolean)
    .join("\n\n");
}
