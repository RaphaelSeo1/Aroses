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

type TextItem = { str?: string; hasEOL?: boolean };

export type PdfPageText = { pageNum: number; text: string };

async function loadPdf(buffer: Buffer) {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(Buffer.from(buffer));
  const loadingTask = pdfjsLib.getDocument({
    data,
    disableFontFace: true,
    useSystemFonts: false,
  });
  const timer = setTimeout(() => {
    try {
      void loadingTask.destroy();
    } catch {
      /* ignore */
    }
  }, 40_000);
  try {
    return await Promise.race([
      loadingTask.promise,
      new Promise<never>((_, reject) => {
        setTimeout(
          () =>
            reject(
              new Error(
                "That PDF is taking too long to open. Try a smaller file or a .pptx."
              )
            ),
          40_000
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Per-page text for lecture slide notes. */
export async function extractPdfPages(
  buffer: Buffer,
  options?: { maxPages?: number }
): Promise<{ pages: PdfPageText[]; numpages: number }> {
  const pdf = await loadPdf(buffer);
  try {
    const numpages = pdf.numPages;
    const cap = Math.min(numpages, options?.maxPages ?? MAX_PAGES, MAX_PAGES);
    const pages: PdfPageText[] = [];
    for (let i = 1; i <= cap; i += 1) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const items = (content.items as TextItem[]) ?? [];
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
      pages.push({ pageNum: i, text: lines.join("\n") });
      page.cleanup();
    }
    return { pages, numpages };
  } finally {
    await pdf.destroy().catch(() => {});
  }
}

export async function extractPdfText(buffer: Buffer): Promise<string> {
  try {
    // Dynamic import so pdfjs-dist isn't pulled into builds that
    // never call this (e.g. course routes that already have their
    // own ingest pipeline).
    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const data = new Uint8Array(Buffer.from(buffer));
    const loadingTask = pdfjsLib.getDocument({
      data,
      disableFontFace: true,
      useSystemFonts: false,
    });
    const pdf = await loadingTask.promise;

    const pages: string[] = [];
    const pageCount = Math.min(pdf.numPages, MAX_PAGES);
    let totalChars = 0;

    for (let i = 1; i <= pageCount; i += 1) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const items = (content.items as TextItem[]) ?? [];
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
      const pageText = lines.join("\n");
      pages.push(pageText);
      totalChars += pageText.length;
      // Best-effort cleanup of the page-level rendering state.
      page.cleanup();
      if (totalChars >= MAX_CHARS) break;
    }

    await pdf.destroy().catch(() => {
      /* destroy is best-effort — don't fail extraction if cleanup blows up */
    });

    return pages
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
