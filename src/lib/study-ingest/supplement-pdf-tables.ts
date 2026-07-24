import type { IngestChunk } from "@/lib/study-ingest/chunking";
import { parsePageNumbersFromPosition } from "@/lib/study-ingest/chunk-position";
import {
  countMarkdownTables,
  extractMarkdownTableBlocks,
  isUsableMarkdownTable,
} from "@/lib/study-ingest/table-text";
import {
  extractTablesFromPdfPagePng,
  type PageTableExtraction,
} from "@/lib/study-ingest/source-images/extract-pdf-page-tables";
import { pageTableKey } from "@/lib/study-ingest/source-images/page-table-keys";
import { renderPdfPagesToPng } from "@/lib/study-ingest/source-images/render-pdf-page";

const MAX_TABLE_VISION_PAGES = 6;

function chunkHasUsableTables(text: string): boolean {
  const blocks = extractMarkdownTableBlocks(text);
  return blocks.some((b) => isUsableMarkdownTable(b));
}

function chunkLikelyNeedsTableVision(text: string): boolean {
  if (/표\s*3[-–]14/i.test(text)) return true;
  if (/표\s*\d+[-–]\d*/.test(text)) return true;
  if (/모르핀과의\s*비교|코데인.*모르핀|potency/i.test(text)) return true;
  if (/효력|부작용|MAC|분배계수|potency|contraindication/i.test(text)) {
    return countMarkdownTables(text) === 0 || !chunkHasUsableTables(text);
  }
  return false;
}

/** Pages where PDF text references tables but extraction quality is poor. */
export function collectPagesNeedingTableVision(chunks: IngestChunk[]): number[] {
  const pages = new Set<number>();
  for (const chunk of chunks) {
    if (!chunkLikelyNeedsTableVision(chunk.text)) continue;
    for (const pageNum of parsePageNumbersFromPosition(chunk.position)) {
      pages.add(pageNum);
    }
  }
  return [...pages].sort((a, b) => a - b).slice(0, MAX_TABLE_VISION_PAGES);
}

export function isPdfTableVisionEnabled(): boolean {
  const raw = process.env.PDF_INGEST_TABLE_VISION?.trim();
  if (raw === "0" || raw?.toLowerCase() === "false") return false;
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

/**
 * Fast table-only enrich: render + vision only on pages that reference 표 N
 * or drug tables, skipping full-page figure pipeline.
 */
export async function supplementPdfTablesOnly(input: {
  pdfBuffer: Buffer;
  sourceFileName: string;
  chunks: IngestChunk[];
  jobId?: string;
}): Promise<PageTableExtraction[]> {
  if (!isPdfTableVisionEnabled()) return [];

  const pageNums = collectPagesNeedingTableVision(input.chunks);
  if (pageNums.length === 0) return [];

  const rendered = await renderPdfPagesToPng(
    input.pdfBuffer,
    pageNums,
    input.sourceFileName
  );
  if (rendered.length === 0) return [];

  const concurrency = Math.min(
    8,
    Math.max(
      1,
      Number.parseInt(process.env.PDF_INGEST_TABLE_VISION_CONCURRENCY ?? "3", 10) ||
        3
    )
  );

  const extractions: PageTableExtraction[] = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, rendered.length) }, async () => {
    while (i < rendered.length) {
      const idx = i++;
      const img = rendered[idx]!;
      try {
        const md = await extractTablesFromPdfPagePng({
          buffer: img.buffer,
          pageNum: img.anchorIndex,
          sourceFileName: img.sourceFileName,
        });
        if (!md || !isUsableMarkdownTable(md)) continue;
        extractions.push({
          key: pageTableKey(img.sourceFileName, img.anchorIndex),
          sourceFileName: img.sourceFileName,
          pageNum: img.anchorIndex,
          markdown: md,
        });
      } catch (e) {
        console.warn("[supplementPdfTablesOnly] page", img.anchorIndex, e);
      }
    }
  });
  await Promise.all(workers);

  if (extractions.length > 0) {
    console.info("[supplementPdfTablesOnly]", {
      jobId: input.jobId,
      pagesRequested: pageNums.length,
      pagesRendered: rendered.length,
      tablesFound: extractions.length,
    });
  }
  return extractions;
}
