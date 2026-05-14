/**
 * Faster PDF text for ingest than parsing every page: render **first N** and **last M**
 * pages only when the deck is long. Matches how we later `truncateMaterial` (head + tail).
 * Uses the same PDF.js build that `pdf-parse` bundles (`v1.10.100`).
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFJS: any = require("pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js");

type TextContentItem = { str: string; transform: number[] };

type PageData = {
  getTextContent: (opts: {
    normalizeWhitespace: boolean;
    disableCombineTextItems: boolean;
  }) => Promise<{ items: TextContentItem[] }>;
};

type PdfDoc = {
  numPages: number;
  getPage: (pageIndex: number) => Promise<PageData>;
  destroy: () => void;
};

async function pageToText(pageData: PageData): Promise<string> {
  const textContent = await pageData.getTextContent({
    normalizeWhitespace: false,
    disableCombineTextItems: false,
  });
  let lastY: number | undefined;
  let text = "";
  for (const item of textContent.items) {
    const y = item.transform[5];
    if (lastY === y || lastY === undefined) {
      text += item.str;
    } else {
      text += `\n${item.str}`;
    }
    lastY = y;
  }
  return text;
}

/** Process pages in parallel batches instead of one-by-one for much faster extraction. */
const RENDER_BATCH_SIZE = 10;

async function renderPageRange(
  doc: PdfDoc,
  fromInclusive: number,
  toInclusive: number,
  onEveryPages: { n: number; fn: () => Promise<void> } | undefined
): Promise<string> {
  const pageNums: number[] = [];
  for (let p = fromInclusive; p <= toInclusive; p++) pageNums.push(p);

  const parts: string[] = new Array(pageNums.length);
  let rendered = 0;

  for (let i = 0; i < pageNums.length; i += RENDER_BATCH_SIZE) {
    const batch = pageNums.slice(i, i + RENDER_BATCH_SIZE);
    const texts = await Promise.all(
      batch.map(async (p) => {
        const page = await doc.getPage(p);
        return pageToText(page);
      })
    );
    for (let j = 0; j < texts.length; j++) {
      parts[i + j] = texts[j];
      rendered++;
      if (onEveryPages && rendered % onEveryPages.n === 0) {
        await onEveryPages.fn();
      }
    }
  }

  return parts.join("\n\n");
}

function envPositiveInt(name: string, fallback: number, max: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(max, Math.floor(n));
}

export type ExtractPdfTextFastOptions = {
  /** First pages to extract when skipping the middle (default 32). */
  headPages?: number;
  /** Last pages to extract when skipping the middle (default 20). */
  tailPages?: number;
  /** If total pages ≤ this, extract every page (default 48). */
  fullParseMaxPages?: number;
  onHeartbeat?: () => Promise<void>;
};

/**
 * @returns trimmed text, page count, and whether middle pages were skipped.
 */
export async function extractPdfTextHeadTail(
  buffer: Buffer,
  options?: ExtractPdfTextFastOptions
): Promise<{ text: string; numpages: number; skippedMiddle: boolean }> {
  PDFJS.disableWorker = true;
  const doc: PdfDoc = await PDFJS.getDocument(buffer);

  const numpages = doc.numPages;

  const headDefault = envPositiveInt("PDF_INGEST_HEAD_PAGES", 32, 120);
  const tailDefault = envPositiveInt("PDF_INGEST_TAIL_PAGES", 20, 120);
  const fullBelowDefault = envPositiveInt(
    "PDF_INGEST_FULL_PARSE_MAX_PAGES",
    48,
    400
  );

  const head = Math.min(options?.headPages ?? headDefault, numpages);
  const tail = Math.min(options?.tailPages ?? tailDefault, numpages);
  const fullBelow = options?.fullParseMaxPages ?? fullBelowDefault;

  const beat =
    options?.onHeartbeat != null
      ? { n: 10, fn: options.onHeartbeat }
      : undefined;

  let text: string;
  let skippedMiddle = false;

  try {
    if (numpages <= fullBelow || numpages <= head + tail) {
      text = await renderPageRange(doc, 1, numpages, beat);
    } else {
      const tailStart = numpages - tail + 1;
      if (tailStart <= head + 1) {
        text = await renderPageRange(doc, 1, numpages, beat);
      } else {
        const headPart = await renderPageRange(doc, 1, head, beat);
        const tailPart = await renderPageRange(doc, tailStart, numpages, beat);
        skippedMiddle = true;
        text = `${headPart}\n\n[ … PDF pages ${head + 1}–${tailStart - 1} omitted during optimized text extraction … ]\n\n${tailPart}`;
      }
    }
  } finally {
    try {
      doc.destroy();
    } catch {
      /* ignore */
    }
  }

  return { text: text.trim(), numpages, skippedMiddle };
}
