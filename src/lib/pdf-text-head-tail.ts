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
const RENDER_BATCH_SIZE = 14;

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
  /** First pages to extract when skipping the middle (default from env `PDF_INGEST_HEAD_PAGES`, else 12). */
  headPages?: number;
  /** Last pages to extract when skipping the middle (default from env `PDF_INGEST_TAIL_PAGES`, else 6). */
  tailPages?: number;
  /** If total pages <= this, extract every page (default from env `PDF_INGEST_FULL_PARSE_MAX_PAGES`, else 16). */
  fullParseMaxPages?: number;
  onHeartbeat?: () => Promise<void>;
};

export type ExtractPdfTextFullOptions = {
  onHeartbeat?: () => Promise<void>;
  /**
   * Parallel page batch size for full-document reads (default from env
   * `PDF_INGEST_FULL_RENDER_BATCH`, else 10 — lower than head/tail so many
   * concurrent jobs do not oversubscribe the host).
   */
  renderBatchSize?: number;
};

export type PdfPageText = { pageNum: number; text: string };

export type ExtractPdfPagesOptions = ExtractPdfTextFullOptions & {
  /** Cap pages read (default: entire document). */
  maxPages?: number;
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
    }, 8_000);
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

    // Default slice for the single-pass outline. Big enough for Claude to
    // ground the outline, small enough that many parallel jobs stay snappy.
    const headDefault = envPositiveInt("PDF_INGEST_HEAD_PAGES", 12, 120);
    const tailDefault = envPositiveInt("PDF_INGEST_TAIL_PAGES", 6, 120);
    const fullBelowDefault = envPositiveInt(
      "PDF_INGEST_FULL_PARSE_MAX_PAGES",
      16,
      400
    );

    const head = Math.min(options?.headPages ?? headDefault, numpages);
    const tail = Math.min(options?.tailPages ?? tailDefault, numpages);
    const fullBelow = options?.fullParseMaxPages ?? fullBelowDefault;

    const beat =
      options?.onHeartbeat != null
        ? { n: 5, fn: options.onHeartbeat }
        : undefined;

    try {
      // Full parse only for very short PDFs. Otherwise extract just the head
      // (and optional tail) for the live preview — the runner reads every
      // page separately for the final course.
      if (numpages <= fullBelow) {
        text = await renderPageRange(pdf, 1, numpages, beat);
      } else if (tail === 0) {
        const safeHead = Math.min(head, numpages);
        text = await renderPageRange(pdf, 1, safeHead, beat);
        skippedMiddle = safeHead < numpages;
      } else {
        const tailStart = numpages - tail + 1;
        // Head and tail ranges overlap — must merge as one full pass.
        if (tailStart <= head + 1) {
          text = await renderPageRange(pdf, 1, numpages, beat);
        } else {
          const [headPart, tailPart] = await Promise.all([
            renderPageRange(pdf, 1, head, beat),
            renderPageRange(pdf, tailStart, numpages, beat),
          ]);
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

async function renderPageRangeWithBatchSize(
  doc: PdfDoc,
  fromInclusive: number,
  toInclusive: number,
  batchSize: number,
  onEveryPages: { n: number; fn: () => Promise<void> } | undefined
): Promise<string> {
  const pageNums: number[] = [];
  for (let p = fromInclusive; p <= toInclusive; p++) pageNums.push(p);

  const parts: string[] = new Array(pageNums.length);
  let rendered = 0;

  for (let i = 0; i < pageNums.length; i += batchSize) {
    const batch = pageNums.slice(i, i + batchSize);
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

async function renderPagesIndividually(
  doc: PdfDoc,
  fromInclusive: number,
  toInclusive: number,
  batchSize: number,
  onEveryPages: { n: number; fn: () => Promise<void> } | undefined
): Promise<PdfPageText[]> {
  const pageNums: number[] = [];
  for (let p = fromInclusive; p <= toInclusive; p++) pageNums.push(p);

  const results: PdfPageText[] = [];
  let rendered = 0;

  for (let i = 0; i < pageNums.length; i += batchSize) {
    const batch = pageNums.slice(i, i + batchSize);
    const texts = await Promise.all(
      batch.map(async (p) => {
        const page = await doc.getPage(p);
        return pageToText(page);
      })
    );
    for (let j = 0; j < texts.length; j++) {
      results.push({ pageNum: batch[j]!, text: texts[j]!.trim() });
      rendered++;
      if (onEveryPages && rendered % onEveryPages.n === 0) {
        await onEveryPages.fn();
      }
    }
  }

  return results;
}

/**
 * Per-page text for course ingest — one chunk per page so the structure planner
 * can assign coverage across the full document (not just head/tail).
 */
export async function extractPdfPagesForIngest(
  buffer: Buffer,
  options?: ExtractPdfPagesOptions
): Promise<{ pages: PdfPageText[]; numpages: number; truncated: boolean }> {
  PDFJS.disableWorker = true;

  let wallClock: ReturnType<typeof setInterval> | undefined;
  if (options?.onHeartbeat) {
    void options.onHeartbeat();
    wallClock = setInterval(() => {
      void options.onHeartbeat!();
    }, 8_000);
  }

  const batchSize = envPositiveInt(
    "PDF_INGEST_FULL_RENDER_BATCH",
    14,
    RENDER_BATCH_SIZE
  );

  let doc: PdfDoc | null = null;
  try {
    doc = await PDFJS.getDocument(buffer);
    if (!doc) {
      throw new Error("Failed to load PDF document");
    }
    const pdf = doc;
    const numpages = pdf.numPages;
    const readThrough = Math.min(
      numpages,
      options?.maxPages != null && options.maxPages >= 1
        ? Math.floor(options.maxPages)
        : numpages
    );
    const beat =
      options?.onHeartbeat != null
        ? { n: 5, fn: options.onHeartbeat }
        : undefined;

    let pages: PdfPageText[];
    try {
      pages = await renderPagesIndividually(
        pdf,
        1,
        readThrough,
        options?.renderBatchSize ?? batchSize,
        beat
      );
    } finally {
      try {
        pdf.destroy();
      } catch {
        /* ignore */
      }
    }

    return {
      pages,
      numpages,
      truncated: readThrough < numpages,
    };
  } finally {
    if (wallClock) clearInterval(wallClock);
  }
}

/**
 * Extract text from **every** page (for final ingest after a fast head/tail preview).
 * Uses a smaller default batch size than the head/tail path to stay gentle when
 * many PDF jobs run at once.
 */
export async function extractPdfTextFullDocument(
  buffer: Buffer,
  options?: ExtractPdfTextFullOptions
): Promise<{ text: string; numpages: number }> {
  PDFJS.disableWorker = true;

  let wallClock: ReturnType<typeof setInterval> | undefined;
  if (options?.onHeartbeat) {
    void options.onHeartbeat();
    wallClock = setInterval(() => {
      void options.onHeartbeat!();
    }, 8_000);
  }

  const batchSize = envPositiveInt(
    "PDF_INGEST_FULL_RENDER_BATCH",
    14,
    RENDER_BATCH_SIZE
  );

  let doc: PdfDoc | null = null;
  try {
    doc = await PDFJS.getDocument(buffer);
    if (!doc) {
      throw new Error("Failed to load PDF document");
    }
    const pdf = doc;
    const numpages = pdf.numPages;
    const beat =
      options?.onHeartbeat != null
        ? { n: 5, fn: options.onHeartbeat }
        : undefined;

    let text: string;
    try {
      text = await renderPageRangeWithBatchSize(
        pdf,
        1,
        numpages,
        options?.renderBatchSize ?? batchSize,
        beat
      );
    } finally {
      try {
        pdf.destroy();
      } catch {
        /* ignore */
      }
    }

    return { text: text.trim(), numpages };
  } finally {
    if (wallClock) clearInterval(wallClock);
  }
}
