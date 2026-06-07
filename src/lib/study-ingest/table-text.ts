/**
 * Helpers for preserving tabular PDF text through ingest → lesson generation.
 * PDF.js often emits table rows as tab- or space-separated runs on one line;
 * converting those blocks to markdown tables gives the lesson LLM structured data.
 */

export type MaterialTableDiagnostics = {
  charCount: number;
  markdownTableCount: number;
  tabularLineCount: number;
  tableRefCount: number;
  macMentionCount: number;
  partitionCoeffMention: boolean;
  sampleTabularLines: string[];
};

/** Count GitHub-flavored markdown table separator rows. */
export function countMarkdownTables(text: string): number {
  return (text.match(/^\s*\|[\s\-:|]+\|\s*$/gm) || []).length;
}

function tabCount(line: string): number {
  return (line.match(/\t/g) || []).length;
}

/** Slide/header/footer rows from this PDF — not data tables. */
function isPdfChromeRow(line: string): boolean {
  const t = line.trim();
  if (/^3\s*장\s*중추신경계통/i.test(t)) return true;
  if (/^\|\s*3\s*장\s*\|/i.test(t)) return true;
  if (/^_\[\d+\]/.test(t)) return true;
  if (t.split(/\t+/).length >= 4 && /중추신경계통|약물/.test(t) && !/\d+\.\d+/.test(t)) {
    return true;
  }
  return false;
}

/** True when a line looks like a PDF table row (tab-separated columns). */
function looksTabularRow(line: string): boolean {
  if (isPdfChromeRow(line)) return false;
  return tabCount(line) >= 3;
}

function splitTabularRow(line: string): string[] {
  return line.split(/\t+/).map((c) => c.trim()).filter(Boolean);
}

function tabBlockToMarkdownTable(block: string[]): string {
  const rows = block.map(splitTabularRow).filter((r) => r.length >= 2);
  if (rows.length < 2) return block.join("\n");
  const colCount = Math.max(...rows.map((r) => r.length));
  const normalized = rows.map((r) => {
    const copy = [...r];
    while (copy.length < colCount) copy.push("");
    return copy.slice(0, colCount);
  });
  const escape = (c: string) => c.replace(/\|/g, "\\|");
  const header = `| ${normalized[0]!.map(escape).join(" | ")} |`;
  const sep = `| ${normalized[0]!.map(() => "---").join(" | ")} |`;
  const body = normalized
    .slice(1)
    .map((r) => `| ${r.map(escape).join(" | ")} |`)
    .join("\n");
  return [header, sep, body].join("\n");
}

/**
 * Scan plain text for consecutive tabular lines and rewrite them as markdown
 * tables so downstream lesson prompts receive structured data.
 */
export function enhanceTabularPlaintext(text: string): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (looksTabularRow(line)) {
      const block: string[] = [];
      while (i < lines.length && looksTabularRow(lines[i]!)) {
        block.push(lines[i]!);
        i++;
      }
      if (block.length >= 2) {
        out.push(tabBlockToMarkdownTable(block));
        continue;
      }
      out.push(...block);
      continue;
    }
    out.push(line);
    i++;
  }
  return out.join("\n");
}

export function diagnoseMaterialTables(text: string): MaterialTableDiagnostics {
  const lines = text.split(/\r?\n/);
  const tabularLines = lines.filter(looksTabularRow);
  const tableRefs = text.match(/표\s*\d+[-–]\d*/g) || [];
  const macMentions = text.match(/\bMAC\b|최소폐포농도/gi) || [];
  return {
    charCount: text.length,
    markdownTableCount: countMarkdownTables(text),
    tabularLineCount: tabularLines.length,
    tableRefCount: tableRefs.length,
    macMentionCount: macMentions.length,
    partitionCoeffMention: /혈액가스분배계수|blood.?gas partition/i.test(text),
    sampleTabularLines: tabularLines.slice(0, 4).map((l) => l.slice(0, 160)),
  };
}

export function logMaterialTableDiagnostics(
  label: string,
  materialText: string,
  moduleIndex?: number
): void {
  if (process.env.LOG_LESSON_GEN_INPUT !== "1") return;
  const d = diagnoseMaterialTables(materialText);
  console.info(`[lesson-gen-input] ${label}`, {
    moduleIndex,
    ...d,
    head: materialText.slice(0, 1200),
    tail: materialText.slice(-800),
  });
}
