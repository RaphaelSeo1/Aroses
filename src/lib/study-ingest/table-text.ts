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
        const md = tabBlockToMarkdownTable(block);
        if (isUsableMarkdownTable(md)) {
          out.push(md);
        } else {
          out.push(...block);
        }
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

/** Known OCR misreads in vision-extracted tables only (not prose substitutions). */
const TABLE_OCR_REPLACEMENTS: ReadonlyArray<[RegExp, string]> = [
  [/제37/g, "제3기"],
  [/제47/g, "제4기"],
  [/여름음/g, "흥분기"],
  [/친절기/g, "진통기"],
  [/부디오페논/g, "부티로페논"],
  [/퍼페나징/g, "페르페나진"],
  [/예열/g, "계열"],
];

/** Corrupted OCR blobs — reject tables containing these patterns. */
const TABLE_GARBAGE_PATTERNS: RegExp[] = [
  /숨넘어/,
  /황강관/,
  /황불안/,
  /C₆우흥/,
  /의식유존/,
  /여러움/,
  /제4\d\(/, // 제47(숨넘어…)
  /슬신경마비/, // wrong nerve (source: 숨뇌마비기)
  /대뇌겉질\s*전에부위/,
  /전에부위에\s*환정/,
  /깊은\s*일렬\s*의의/,
  /일렬\s*의의\s*과정/,
  /겉질\s*전에/,
];

/** Fix common collapsed numeric ranges (en-dash eaten: 1–4 → 14). */
const KNOWN_COLLAPSED_RANGES: ReadonlyArray<[RegExp, string]> = [
  [/\b14단계\b/g, "1–4단계"],
  [/\b13단계\b/g, "1–3단계"],
  [/\b23시간\b/g, "2–3시간"],
  [/\b1018시간\b/g, "10–18시간"],
  [/\b47100시간\b/g, "47–100시간"],
];

const RANGE_IN_CELL = /(\d+)\s*[-–—]\s*(\d+)/g;
const COLLAPSED_RANGE_PROSE =
  /\b(\d{2,5})(시간|분|일|단계|기|mg|μg|mcg|년)\b/g;

function collapsedRangeKey(lo: string, hi: string): string {
  return `${lo}${hi}`;
}

/** Collect canonical ranges from markdown table cells (e.g. 2–3, 10-18). */
function rangesFromMarkdownTables(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of text.split("\n")) {
    if (!line.includes("|")) continue;
    let m: RegExpExecArray | null;
    const re = new RegExp(RANGE_IN_CELL.source, "g");
    while ((m = re.exec(line)) !== null) {
      const lo = m[1]!;
      const hi = m[2]!;
      const canonical = `${lo}–${hi}`;
      map.set(collapsedRangeKey(lo, hi), canonical);
    }
  }
  return map;
}

function isMarkdownTableLine(line: string): boolean {
  const t = line.trim();
  return t.startsWith("|") && t.includes("|");
}

function repairProseRangesUsingTableHints(
  prose: string,
  tableRanges: Map<string, string>
): string {
  if (tableRanges.size === 0) return prose;
  return prose.replace(COLLAPSED_RANGE_PROSE, (full, num: string, unit: string) => {
    const canonical = tableRanges.get(num);
    if (!canonical) return full;
    return `${canonical}${unit}`;
  });
}

function tableCellTexts(md: string): string[] {
  const cells: string[] = [];
  for (const line of md.split("\n")) {
    if (!line.includes("|") || /^\|[\s\-:|]+\|$/.test(line.trim())) continue;
    for (const cell of line.split("|")) {
      const t = cell.trim();
      if (t.length > 0) cells.push(t);
    }
  }
  return cells;
}

function hangulRatio(text: string): number {
  const chars = [...text.replace(/\s/g, "")];
  if (chars.length === 0) return 0;
  const hangul = chars.filter((c) => /[\uac00-\ud7a3]/.test(c)).length;
  return hangul / chars.length;
}

/** Pharmacology potency / drug-comparison grids (often many short numeric cells). */
function looksLikePotencyOrDrugTable(md: string): boolean {
  const t = md.trim();
  if (/표\s*3[-–]14/i.test(t)) return true;
  if (
    /효력|potency|모르핀|코데인|morphine|codeine|fentanyl|펜타닐/i.test(t) &&
    /\d/.test(t)
  ) {
    return true;
  }
  return false;
}

/** True when markdown looks like a readable reference table, not OCR garbage. */
export function isUsableMarkdownTable(md: string): boolean {
  const t = md.trim();
  if (!t.includes("|") || t.length < 24) return false;
  if (!/^\s*\|[\s\-:|]+\|\s*$/m.test(t)) return false;

  const dataRows = t
    .split("\n")
    .filter((l) => l.includes("|") && !/^\s*\|[\s\-:|]+\|\s*$/.test(l.trim()));
  if (dataRows.length < 2) return false;

  for (const pat of TABLE_GARBAGE_PATTERNS) {
    if (pat.test(t)) return false;
  }

  const cells = tableCellTexts(t);
  if (cells.length < 4) return false;

  const potencyTable = looksLikePotencyOrDrugTable(t);

  const avgLen =
    cells.reduce((n, c) => n + c.length, 0) / Math.max(1, cells.length);
  if (avgLen > 80) return false;

  const shortCells = cells.filter((c) => c.length <= 2).length;
  const shortCellLimit = potencyTable ? 0.65 : 0.45;
  if (shortCells / cells.length > shortCellLimit) return false;

  const hasDigits = cells.some((c) => /\d/.test(c));
  const hasHangul = cells.some((c) => /[\uac00-\ud7a3]/.test(c));
  const hasLatin = cells.some((c) => /[A-Za-z]{3,}/.test(c));
  if (!hasDigits && !hasHangul && !hasLatin) return false;

  const hangulMin = potencyTable ? 0.04 : 0.08;
  if (hasHangul && hangulRatio(t) < hangulMin && !hasLatin) return false;

  return passesClassificationTableQualityCheck(t);
}

/** Split lesson/markdown text into individual GFM table blocks. */
export function extractMarkdownTableBlocks(text: string): string[] {
  const lines = text.split("\n");
  const blocks: string[] = [];
  let current: string[] = [];

  const flush = () => {
    const joined = current.join("\n").trim();
    if (joined.includes("|") && /^\s*\|[\s\-:|]+\|\s*$/m.test(joined)) {
      blocks.push(joined);
    }
    current = [];
  };

  for (const line of lines) {
    if (line.trim().startsWith("|") && line.includes("|")) {
      current.push(line);
      continue;
    }
    if (current.length > 0) flush();
  }
  if (current.length > 0) flush();
  return blocks;
}

/** Headers that only introduce a table — drop with the table if it is removed. */
function isOrphanableTableHeader(line: string): boolean {
  const t = line.trim();
  if (t.length === 0 || t.length > 120) return false;
  if (/^#{1,6}\s/.test(t)) return true;
  if (/[:：]\s*$/.test(t)) return true;
  if (/표\s*\d+[-–]\d*/.test(t)) return true;
  if (/비교\s*[:：]?\s*$/i.test(t)) return true;
  return false;
}

function stripOrphanedTableHeaders(content: string): string {
  const lines = content.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const next = lines[i + 1]?.trim() ?? "";
    if (
      isOrphanableTableHeader(line) &&
      next.length > 0 &&
      !next.startsWith("|")
    ) {
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

/** Remove corrupted markdown tables from lesson content. */
export function stripUnusableMarkdownTables(content: string): string {
  const blocks = extractMarkdownTableBlocks(content);
  if (blocks.length === 0) return content;

  let out = content;
  for (const block of blocks) {
    if (!isUsableMarkdownTable(block)) {
      const idx = out.indexOf(block);
      if (idx >= 0) {
        const before = out.slice(0, idx);
        const headerLines = before.split("\n");
        while (headerLines.length > 0) {
          const last = headerLines[headerLines.length - 1]!.trim();
          if (last.length === 0) {
            headerLines.pop();
            continue;
          }
          if (isOrphanableTableHeader(last)) {
            headerLines.pop();
            continue;
          }
          break;
        }
        out = `${headerLines.join("\n")}\n${out.slice(idx + block.length)}`.trim();
      } else {
        out = out.replace(block, "").trim();
      }
    }
  }
  return stripOrphanedTableHeaders(out.replace(/\n{4,}/g, "\n\n\n").trim());
}

/** Apply OCR fixes to vision-extracted table markdown. */
export function sanitizeTableMarkdown(md: string): string {
  if (!md.trim().includes("|")) return "";
  let out = md;
  for (const [re, rep] of TABLE_OCR_REPLACEMENTS) {
    out = out.replace(re, rep);
  }
  if (isUsableMarkdownTable(out)) return out;
  if (looksLikePotencyOrDrugTable(out) && /^\s*\|[\s\-:|]+\|\s*$/m.test(out)) {
    const rows = out
      .split("\n")
      .filter((l) => l.includes("|") && !/^\s*\|[\s\-:|]+\|\s*$/.test(l.trim()));
    if (rows.length >= 2 && tableCellTexts(out).length >= 4) return out;
  }
  return "";
}

/** Revert a prior bad substitution in authored lesson prose. */
const PROSE_TERM_CORRECTIONS: ReadonlyArray<[RegExp, string]> = [
  [/슬신경마비기/g, "숨뇌마비기"],
  [/흥전/g, "흥분"],
  [/부디오페논/g, "부티로페논"],
  [/퍼페나징/g, "페르페나진"],
  [/예열(?=기|의|적)/g, "계열"],
];

const POSITIVE_SYMPTOM_MARKERS =
  /환각|망상|사고\s*장애|초조|불안|조증|양성\s*증상/i;
const NEGATIVE_SYMPTOM_MARKERS =
  /감정\s*둔마|의욕\s*저하|무감동|빈동|빈칸|운동\s*완만|무언증|음성\s*증상/i;

function normalizeTableTopicToken(text: string): string {
  return text
    .replace(/[^\p{L}\p{N}]/gu, "")
    .toLowerCase()
    .slice(0, 48);
}

/** Significant tokens for comparing whether two tables cover the same topic. */
export function tableTopicTokens(md: string): Set<string> {
  const tokens = new Set<string>();
  for (const cell of tableCellTexts(md)) {
    const parts = cell.split(/[\s,;/·]+/).filter((p) => p.length >= 2);
    for (const part of parts) {
      const t = normalizeTableTopicToken(part);
      if (t.length >= 2) tokens.add(t);
    }
  }
  const ref = md.match(/표\s*\d+[-–]\d*/i)?.[0];
  if (ref) tokens.add(normalizeTableTopicToken(ref));
  return tokens;
}

export function tablesOnSimilarTopic(a: string, b: string): boolean {
  const ta = tableTopicTokens(a);
  const tb = tableTopicTokens(b);
  if (ta.size === 0 || tb.size === 0) return false;

  let overlap = 0;
  for (const t of ta) {
    if (tb.has(t)) overlap++;
  }
  const minSize = Math.min(ta.size, tb.size);
  if (overlap >= 2) return true;
  if (overlap >= 1 && minSize <= 4) return true;

  const sharedTopic =
    /발작|뇌전|분류|마취|단계|양성|음성|증상|potency|mac/i;
  const aTopic = sharedTopic.test(a);
  const bTopic = sharedTopic.test(b);
  return aTopic && bTopic && overlap >= 1;
}

function looksLikeClassificationTable(md: string): boolean {
  return /발작|뇌전|분류|유형|양성|음성|단계|기\s*\(|seizure|classification/i.test(
    md
  );
}

/** Stricter gate for mapping/classification grids (e.g. 항뇌전증 분류). */
export function passesClassificationTableQualityCheck(md: string): boolean {
  if (!looksLikeClassificationTable(md)) return true;

  const cells = tableCellTexts(md);
  if (cells.length < 4) return false;

  const headerRow = md
    .split("\n")
    .find((l) => l.includes("|") && !/^\s*\|[\s\-:|]+\|\s*$/.test(l.trim()));
  if (!headerRow) return false;
  const headers = headerRow
    .split("|")
    .map((c) => c.trim())
    .filter(Boolean);
  if (headers.length < 2) return false;

  for (const cell of cells) {
    if (cell.length > 72) return false;
    if (/\S{16,}하여\b/.test(cell)) return false;
    if (/의의\s*과정|전에부위|일렬\s*의/.test(cell)) return false;
  }

  const avgLen =
    cells.reduce((n, c) => n + c.length, 0) / Math.max(1, cells.length);
  if (avgLen > 36) return false;

  return true;
}

function contentHasUsableTableOnTopic(content: string, tableMd: string): boolean {
  for (const block of extractMarkdownTableBlocks(content)) {
    if (
      isUsableMarkdownTable(block) &&
      passesClassificationTableQualityCheck(block) &&
      tablesOnSimilarTopic(block, tableMd)
    ) {
      return true;
    }
  }
  return false;
}

/** True when an injected PDF table should be skipped for this lesson body. */
export function shouldSkipTableInjection(
  content: string,
  tableMd: string
): boolean {
  const cleaned = sanitizeTableMarkdown(tableMd).trim();
  if (!cleaned.includes("|")) return true;
  if (!isUsableMarkdownTable(cleaned)) return true;
  if (!passesClassificationTableQualityCheck(cleaned)) return true;
  if (contentHasUsableTableOnTopic(content, cleaned)) return true;
  return false;
}

/**
 * When multiple markdown tables cover the same topic and only one is readable,
 * drop the corrupted duplicate.
 */
export function dedupeRedundantTablesInContent(content: string): string {
  const blocks = extractMarkdownTableBlocks(content);
  if (blocks.length < 2) return content;

  const toRemove = new Set<string>();
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      const a = blocks[i]!;
      const b = blocks[j]!;
      if (!tablesOnSimilarTopic(a, b)) continue;

      const aGood =
        isUsableMarkdownTable(a) && passesClassificationTableQualityCheck(a);
      const bGood =
        isUsableMarkdownTable(b) && passesClassificationTableQualityCheck(b);

      if (aGood && !bGood) toRemove.add(b);
      else if (!aGood && bGood) toRemove.add(a);
      else if (!aGood && !bGood) toRemove.add(j > i ? b : a);
    }
  }

  if (toRemove.size === 0) return content;

  let out = content;
  for (const block of toRemove) {
    const idx = out.indexOf(block);
    if (idx >= 0) {
      const before = out.slice(0, idx);
      const headerLines = before.split("\n");
      while (headerLines.length > 0) {
        const last = headerLines[headerLines.length - 1]!.trim();
        if (last.length === 0) {
          headerLines.pop();
          continue;
        }
        if (isOrphanableTableHeader(last)) {
          headerLines.pop();
          continue;
        }
        break;
      }
      out = `${headerLines.join("\n")}\n${out.slice(idx + block.length)}`.trim();
    } else {
      out = out.replace(block, "").trim();
    }
  }
  return stripOrphanedTableHeaders(out.replace(/\n{4,}/g, "\n\n\n").trim());
}

function stripBulletPrefix(line: string): string | null {
  const t = line.trim();
  const bullet = t.match(/^[-*•]\s+(.+)$/);
  if (bullet) return bullet[1]!.trim();
  const labeled = t.match(/^\*\*([^*]+)\*\*[:：]?\s*(.+)$/);
  if (labeled) return labeled[2]!.trim();
  return null;
}

/** Rebuild flattened 양성/음성 symptom lists into a 2-column table when obvious. */
export function repairFlattenedSymptomTables(content: string): string {
  if (
    /\|\s*양성\s*증상\s*\|/i.test(content) ||
    /\|\s*양성증상\s*\|/i.test(content)
  ) {
    return content;
  }

  const lines = content.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const next = lines[i + 1] ?? "";
    const posText = stripBulletPrefix(line);
    const negText = stripBulletPrefix(next);

    if (
      posText &&
      negText &&
      POSITIVE_SYMPTOM_MARKERS.test(posText) &&
      NEGATIVE_SYMPTOM_MARKERS.test(negText) &&
      !line.trim().startsWith("|") &&
      !next.trim().startsWith("|")
    ) {
      out.push("| 양성증상 | 음성증상 |");
      out.push("| --- | --- |");
      out.push(`| ${posText.replace(/\|/g, "\\|")} | ${negText.replace(/\|/g, "\\|")} |`);
      i += 2;
      continue;
    }

    out.push(line);
    i++;
  }
  return out.join("\n");
}

/**
 * Repair lesson prose: range fixes + drop corrupted appended tables.
 */
export function sanitizeLessonContent(content: string): string {
  if (!content.trim()) return content;

  let out = stripUnusableMarkdownTables(content);
  out = repairFlattenedSymptomTables(out);
  out = dedupeRedundantTablesInContent(out);
  for (const [re, rep] of PROSE_TERM_CORRECTIONS) {
    out = out.replace(re, rep);
  }
  for (const [re, rep] of KNOWN_COLLAPSED_RANGES) {
    out = out.replace(re, rep);
  }

  const tableRanges = rangesFromMarkdownTables(out);
  const lines = out.split("\n");
  const fixed = lines.map((line) => {
    if (isMarkdownTableLine(line)) return line;
    let prose = line;
    for (const [re, rep] of KNOWN_COLLAPSED_RANGES) {
      prose = prose.replace(re, rep);
    }
    return repairProseRangesUsingTableHints(prose, tableRanges);
  });
  out = fixed.join("\n");
  return stripUnusableMarkdownTables(out);
}

export function sanitizeModuleLessonContents(
  modules: import("@/types/course").CourseModule[]
): import("@/types/course").CourseModule[] {
  return modules.map((mod) => ({
    ...mod,
    lessons: mod.lessons.map((lesson) => ({
      ...lesson,
      content: sanitizeLessonContent(lesson.content ?? ""),
    })),
  }));
}
