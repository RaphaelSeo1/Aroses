/**
 * Server-side PDF text extraction using pdfjs-dist.
 *
 * Why pdfjs-dist (Mozilla) over alternatives:
 *   - Pure JS, no native bindings — Vercel/edge-friendly.
 *   - Same library Firefox uses, well-tested across PDF generators.
 *   - Streamed text-content API per page → we can early-exit if a
 *     document is enormous.
 *
 * Public API:
 *   - `extractPdfText(buffer)` → Promise<string>
 *
 * Behavior:
 *   - Returns concatenated text with \n\n between pages.
 *   - On any error returns "" so callers can degrade gracefully
 *     (they record the upload with a "couldn't extract" summary).
 *   - Hard caps:
 *       - 200 pages processed
 *       - 200_000 chars returned
 *     to keep token costs sane when someone drops a 1000-page
 *     textbook in.
 *
 * NOT public:
 *   - We use the legacy entry (`pdfjs-dist/legacy/build/pdf.mjs`)
 *     because it ships a self-contained worker — no separate worker
 *     URL plumbing required on the server.
 */

const MAX_PAGES = 200;
const MAX_CHARS = 200_000;
const PAGE_BATCH = 12;

type TextItem = { str?: string; hasEOL?: boolean };

function copyPdfBytes(buffer: Buffer | Uint8Array): Uint8Array {
  return Uint8Array.from(buffer);
}

function pageTextFromItems(items: TextItem[]): string {
  const lines: string[] = [];
  let current = "";
  for (const item of items) {
    if (typeof item.str === "string") current += item.str;
    if (item.hasEOL) {
      if (current.trim().length > 0) lines.push(current.trim());
      current = "";
    }
  }
  if (current.trim().length > 0) lines.push(current.trim());
  return lines.join("\n");
}

/**
 * Per-page PDF text using current pdfjs-dist. Parallel batches beat the
 * pdf-parse v1.10 engine, which blocked for a long time on lecture decks.
 */
export async function extractPdfPages(
  buffer: Buffer | Uint8Array,
  options?: { maxPages?: number }
): Promise<{ pageNum: number; text: string }[]> {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjsLib.getDocument({
    data: copyPdfBytes(buffer),
    disableFontFace: true,
    useSystemFonts: false,
  });
  const pdf = await loadingTask.promise;
  const pageCount = Math.min(
    pdf.numPages,
    options?.maxPages != null && options.maxPages >= 1
      ? Math.floor(options.maxPages)
      : MAX_PAGES
  );
  const pages: { pageNum: number; text: string }[] = [];
  try {
    for (let start = 1; start <= pageCount; start += PAGE_BATCH) {
      const end = Math.min(start + PAGE_BATCH - 1, pageCount);
      const batch = await Promise.all(
        Array.from({ length: end - start + 1 }, (_, i) => start + i).map(
          async (pageNum) => {
            const page = await pdf.getPage(pageNum);
            try {
              const content = await page.getTextContent();
              const items = (content.items as TextItem[]) ?? [];
              return { pageNum, text: pageTextFromItems(items).trim() };
            } finally {
              page.cleanup();
            }
          }
        )
      );
      pages.push(...batch);
    }
  } finally {
    await pdf.destroy().catch(() => {});
  }
  return pages;
}

export async function extractPdfText(buffer: Buffer): Promise<string> {
  try {
    const pages = await extractPdfPages(buffer, { maxPages: MAX_PAGES });
    let totalChars = 0;
    const kept: string[] = [];
    for (const page of pages) {
      kept.push(page.text);
      totalChars += page.text.length;
      if (totalChars >= MAX_CHARS) break;
    }
    return kept
      .join("\n\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, MAX_CHARS);
  } catch (e) {
    console.error("[pdf-text/extract]", e);
    return "";
  }
}
