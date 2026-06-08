import {
  parsePageNumbersFromPosition,
  tablePageOverlapsLesson,
} from "@/lib/study-ingest/chunk-position";
import type { IngestChunk } from "@/lib/study-ingest/chunking";
import type { IngestPageFigure } from "@/lib/study-ingest/inject-pdf-tables-into-module";
import { pageTableKey } from "@/lib/study-ingest/source-images/page-table-keys";
import {
  isUsableMarkdownTable,
  sanitizeTableMarkdown,
} from "@/lib/study-ingest/table-text";

const TABLE_BLOCK_RE =
  /\n\n--- TABLE DATA FROM PDF \(page (\d+)[^)]*\) ---\n[\s\S]*?(?=\n\n--- TABLE DATA FROM PDF|\n\n--- FIGURES FROM ORIGINAL PDF|\n\n\[from |$)/g;

/** Drop vision table blocks whose source page is outside the chunk's page range. */
export function filterChunkTableBlocksToPages(
  text: string,
  allowedPages: Set<number>
): string {
  if (allowedPages.size === 0) return text;
  return text.replace(TABLE_BLOCK_RE, (block, pageStr) => {
    const pageNum = Number.parseInt(pageStr, 10);
    if (!Number.isFinite(pageNum)) return block;
    return tablePageOverlapsLesson(pageNum, allowedPages) ? block : "";
  });
}

/**
 * Append vision-extracted markdown tables to chunk text so module generation
 * sees tabular data that PDF.js text extraction dropped.
 */
export function enrichChunksWithPageTables(
  chunks: IngestChunk[],
  pageTables: Map<string, string>
): IngestChunk[] {
  if (pageTables.size === 0) return chunks;

  return chunks.map((chunk) => {
    const pages = parsePageNumbersFromPosition(chunk.position);
    if (pages.length === 0) return chunk;

    const appendBlocks: string[] = [];
    for (const pageNum of pages) {
      const raw = pageTables.get(pageTableKey(chunk.sourceFileName, pageNum));
      const md = raw ? sanitizeTableMarkdown(raw) : "";
      if (!md || !isUsableMarkdownTable(md)) continue;
      appendBlocks.push(
        `\n\n--- TABLE DATA FROM PDF (page ${pageNum} — reproduce as full markdown table in lesson content) ---\n${md}`
      );
    }
    if (appendBlocks.length === 0) return chunk;
    const text = `${chunk.text}${appendBlocks.join("")}`;
    return { ...chunk, text, approxChars: text.length };
  });
}

/**
 * Append page-render figure refs so module generation sees diagrams that
 * plain text extraction missed (parallel to table enrichment).
 */
export function enrichChunksWithPageFigures(
  chunks: IngestChunk[],
  pageFigures: IngestPageFigure[]
): IngestChunk[] {
  if (pageFigures.length === 0) return chunks;

  return chunks.map((chunk) => {
    const pages = parsePageNumbersFromPosition(chunk.position);
    if (pages.length === 0) return chunk;

    const appendBlocks: string[] = [];
    for (const pageNum of pages) {
      const figs = pageFigures.filter(
        (f) =>
          f.sourceFileName.trim().toLowerCase() ===
            chunk.sourceFileName.trim().toLowerCase() && f.pageNum === pageNum
      );
      for (const fig of figs) {
        appendBlocks.push(
          `\n\n--- FIGURES FROM ORIGINAL PDF (page ${pageNum}, preserve in lesson) ---\n![${fig.caption}](${fig.url})`
        );
      }
    }
    if (appendBlocks.length === 0) return chunk;
    const text = `${chunk.text}${appendBlocks.join("")}`;
    return { ...chunk, text, approxChars: text.length };
  });
}
