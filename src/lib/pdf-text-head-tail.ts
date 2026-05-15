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
const RENDER_BATCH_SIZE = 22;

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
  /** First pages when skipping the middle (default from env `PDF_INGEST_HEAD_PAGES`, else 14). */
  headPages?: number;
  /** Last pages when skipping the middle (default from env `PDF_INGEST_TAIL_PAGES`, else 10). */
  tailPages?: number;
  /** If total pages ≤ this, extract every page (default from env `PDF_INGEST_FULL_PARSE_MAX_PAGES`, else 16). */
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

  // `getDocument` can block for minutes on huge PDFs with no per-page callbacks.
  // Keep `updated_at` moving so GET /jobs/:id stall-recovery does not flip the
  // job back to `pending` while extraction is legitimately still running.
  let wallClock: ReturnType<typeof setInterval> | undefined;
  if (options?.onHeartbeat) {
    void options.onHeartbeat();
    wallClock = setInterval(() => {
      void options.onHeartbeat!();
    }, 12_000);
  }

  let doc: PdfDoc | null = null;
  let text = "";
  let skippedMiddle = false;
  let numpages = 0;

  try {
    doc = await PDFJS.getDocument(buffer);
    if (!doc) {
      throw new Error("Failed to load PDF document");
    }
    const pdf = doc;
    numpages = pdf.numPages;

    // Defaults tuned for lecture PDFs: only very short decks get a full parse.
    // Older logic also treated n <= head+tail as "full parse", which meant almost
    // every deck (≤52 pages) extracted every page — very slow on slide-heavy PDFs.
    // Smaller defaults + overlap fix: with head=24 tail=14, any deck n≤38 hit the
    // "overlap" branch and parsed **every** page — very slow for typical slide PDFs.
    const headDefault = envPositiveInt("PDF_INGEST_HEAD_PAGES", 14, 120);
    const tailDefault = envPositiveInt("PDF_INGEST_TAIL_PAGES", 10, 120);
    const fullBelowDefault = envPositiveInt(
      "PDF_INGEST_FULL_PARSE_MAX_PAGES",
      16,
      400
    );
    /** If head+tail would cover the whole file but the deck is larger than this, shrink head/tail to skip the middle instead of parsing every page. */
    const mergeFullMax = envPositiveInt("PDF_INGEST_MERGE_FULL_MAX_PAGES", 22, 80);

    let head = Math.min(options?.headPages ?? headDefault, numpages);
    let tail = Math.min(options?.tailPages ?? tailDefault, numpages);
    const fullBelow = options?.fullParseMaxPages ?? fullBelowDefault;

    const beat =
      options?.onHeartbeat != null
        ? { n: 5, fn: options.onHeartbeat }
        : undefined;

    try {
      // Full parse only for genuinely short PDFs.
      if (numpages <= fullBelow) {
        text = await renderPageRange(pdf, 1, numpages, beat);
      } else {
        let tailStart = numpages - tail + 1;
        // When ranges touch/overlap, naive code would read all n pages. For decks
        // above `mergeFullMax`, shrink head/tail until there is a middle gap to skip.
        while (
          tailStart <= head + 1 &&
          numpages > mergeFullMax &&
          (head > 8 || tail > 8)
        ) {
          if (head > 8) head -= 2;
          if (tail > 8) tail -= 2;
          tail = Math.min(tail, numpages);
          head = Math.min(head, numpages);
          tailStart = numpages - tail + 1;
        }
        if (tailStart <= head + 1) {
          text = await renderPageRange(pdf, 1, numpages, beat);
        } else {
          const headPart = await renderPageRange(pdf, 1, head, beat);
          const tailPart = await renderPageRange(pdf, tailStart, numpages, beat);
          skippedMiddle = true;
          text = `${headPart}\n\n[ … PDF pages ${head + 1}–${tailStart - 1} omitted during optimized text extraction … ]\n\n${tailPart}`;
        }
      }
    } finally {
      try {
        pdf.destroy();
      } catch {
        /* ignore */
      }
    }

    return { text: text.trim(), numpages, skippedMiddle };
  } finally {
    if (wallClock) clearInterval(wallClock);
  }
}
