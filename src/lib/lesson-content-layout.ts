import {
  extractMarkdownTableBlocks,
  isUsableMarkdownTable,
} from "@/lib/study-ingest/table-text";

export type MarkdownFigure = {
  alt: string;
  url: string;
};

const MD_IMAGE_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;

/** Pull markdown image references out of lesson body text. */
export function extractMarkdownFigures(markdown: string): MarkdownFigure[] {
  const figures: MarkdownFigure[] = [];
  for (const match of markdown.matchAll(MD_IMAGE_RE)) {
    figures.push({ alt: match[1], url: match[2] });
  }
  return figures;
}

/** Remove markdown images so the remaining text can flow beside figures. */
export function stripMarkdownFigures(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]+\)\s*/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Remove markdown images and HTML `<img>` tags from lesson body text. */
export function stripAllImagesFromMarkdown(markdown: string): string {
  let s = stripMarkdownFigures(markdown);
  s = s.replace(/<img\b[^>]*\/?>\s*/gi, "");
  return s.replace(/\n{3,}/g, "\n\n").trim();
}

/** Split lead paragraph from the rest of the lesson body. */
export function splitLeadParagraph(markdown: string): {
  lead: string;
  body: string;
} {
  const trimmed = markdown.trim();
  if (!trimmed) return { lead: "", body: "" };
  const breakAt = trimmed.indexOf("\n\n");
  if (breakAt === -1) return { lead: trimmed, body: "" };
  return {
    lead: trimmed.slice(0, breakAt).trim(),
    body: trimmed.slice(breakAt + 2).trim(),
  };
}

/** Short caption for a figure (drops the "from filename.ext" suffix). */
export function figureCaption(alt: string): string {
  const fromIdx = alt.lastIndexOf(" from ");
  return fromIdx > 0 ? alt.slice(0, fromIdx).trim() : alt.trim();
}

export function lessonMarkdownHasImages(content: string): boolean {
  return extractMarkdownFigures(content).length > 0;
}

/** Split prose from the first GFM table so figures never float over tables. */
export function splitMarkdownBeforeFirstTable(markdown: string): {
  prose: string;
  tables: string;
} {
  const lines = markdown.split("\n");
  let tableStart = -1;
  for (let i = 0; i < lines.length - 1; i++) {
    if (/^\s*\|/.test(lines[i]!) && /^\s*\|[\s\-:|]+\|/.test(lines[i + 1]!)) {
      tableStart = i;
      break;
    }
  }
  if (tableStart < 0) {
    return { prose: markdown.trim(), tables: "" };
  }
  return {
    prose: lines.slice(0, tableStart).join("\n").trim(),
    tables: lines.slice(tableStart).join("\n").trim(),
  };
}

/** Pipe rows without a `|---|` separator — common in LLM-authored lessons. */
function normalizeLoosePipeTable(markdown: string): string | null {
  const lines = markdown
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("|") && l.includes("|"));
  if (lines.length < 2) return null;
  if (lines.some((l) => /^\|[\s\-:|]+\|\s*$/.test(l))) {
    return lines.join("\n");
  }
  const colCount = Math.max(
    ...lines.map((l) => l.split("|").filter((c) => c.trim().length > 0).length)
  );
  if (colCount < 2) return null;
  const sep = `| ${Array(colCount).fill("---").join(" | ")} |`;
  return [lines[0]!, sep, ...lines.slice(1)].join("\n");
}

/** First GFM table block in lesson body — for whiteboard substrate. */
export function resolveLessonTableMarkdown(content: string): string | null {
  const trimmed = content?.trim() ?? "";
  if (!trimmed) return null;

  const { tables } = splitMarkdownBeforeFirstTable(trimmed);
  if (tables.trim()) return tables.trim();

  const usable = extractMarkdownTableBlocks(trimmed).filter(isUsableMarkdownTable);
  if (usable[0]?.trim()) return usable[0]!.trim();

  const loose = extractMarkdownTableBlocks(trimmed);
  if (loose[0]?.trim()) return loose[0]!.trim();

  return normalizeLoosePipeTable(trimmed);
}

/** Prefer one lesson, then scan siblings — tables often live on a nearby lesson. */
export function resolveModuleTableMarkdown(
  lessons: { content?: string }[],
  preferredLessonIndex?: number
): string | null {
  const indices: number[] = [];
  if (
    typeof preferredLessonIndex === "number" &&
    preferredLessonIndex >= 0 &&
    preferredLessonIndex < lessons.length
  ) {
    indices.push(preferredLessonIndex);
  }
  for (let i = 0; i < lessons.length; i++) {
    if (!indices.includes(i)) indices.push(i);
  }
  for (const i of indices) {
    const md = resolveLessonTableMarkdown(lessons[i]?.content ?? "");
    if (md) return md;
  }
  return null;
}

function corpusLooksLikeCellComparison(text: string): boolean {
  return /prokaryot/i.test(text) && /eukaryot/i.test(text);
}

/** Fallback GFM table when lesson prose has no extractable grid but chunk is clearly comparative. */
function buildCellComparisonTableFallback(keyPoints: string[]): string {
  const parsedRows = keyPoints
    .map((kp) => kp.trim())
    .filter((kp) => kp.length > 0)
    .slice(0, 6)
    .map((kp) => {
      const split = kp.split(/\s*(?:—|–|:)\s+/);
      if (split.length >= 3) {
        return `| ${split[0]!.trim()} | ${split[1]!.trim()} | ${split.slice(2).join(" — ").trim()} |`;
      }
      if (split.length === 2) {
        return `| ${split[0]!.trim()} | ${split[1]!.trim()} | |`;
      }
      return `| ${kp} | | |`;
    });

  if (parsedRows.length >= 2) {
    return [
      "| Feature | Prokaryotic | Eukaryotic |",
      "| --- | --- | --- |",
      ...parsedRows,
    ].join("\n");
  }

  return [
    "| Feature | Prokaryotic | Eukaryotic |",
    "| --- | --- | --- |",
    "| Nucleus | Absent (no membrane-bound nucleus) | Present (membrane-bound) |",
    "| DNA | Circular, in nucleoid region | Linear chromosomes in nucleus |",
    "| Organelles | No membrane-bound organelles | Mitochondria, ER, Golgi, etc. |",
    "| Typical size | Smaller (≈1–10 µm) | Larger (≈10–100 µm) |",
    "| Examples | Bacteria, archaea | Plants, animals, fungi, protists |",
  ].join("\n");
}

/** Resolve whiteboard table markdown for a mentored chunk (lessons → explanation → fallback). */
export function resolveChunkTableMarkdown(
  lessons: { content?: string }[],
  preferredLessonIndex: number | undefined,
  chunk: { explanation?: string; concept?: string; keyPoints?: string[] }
): string | null {
  const fromContent =
    resolveModuleTableMarkdown(lessons, preferredLessonIndex) ??
    resolveLessonTableMarkdown(chunk.explanation ?? "");
  if (fromContent) return fromContent;

  const corpus = [
    chunk.concept ?? "",
    chunk.explanation ?? "",
    ...(chunk.keyPoints ?? []),
  ].join("\n");
  if (corpusLooksLikeCellComparison(corpus)) {
    return buildCellComparisonTableFallback(chunk.keyPoints ?? []);
  }
  return null;
}
