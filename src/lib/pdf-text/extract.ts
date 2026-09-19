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
 *   - `extractPdfPages(buffer)` → Promise<{ pages, numpages }>
 *
 * Behavior:
 *   - Returns concatenated text with \n\n between pages.
 *   - On any error extractPdfText returns "" so callers can degrade
 *     (they record the upload with a "couldn't extract" summary).
 *   - Hard caps:
 *       - 200 pages processed
 *       - 200_000 chars returned
 *     to keep token costs sane when someone drops a 1000-page
 *     textbook in.
 *
 * Slide notes need layout (x/y), not `hasEOL` concatenation. Lecture PDFs
 * often omit EOL flags, so joining item.str produces one unreadable blob
 * and Rose omits it as garbled.
 */

import path from "path";
import { pathToFileURL } from "url";

const MAX_PAGES = 200;
const MAX_CHARS = 200_000;
const RENDER_BATCH_SIZE = 8;
const OPEN_TIMEOUT_MS = 40_000;

export type PdfTextItem = {
  str?: string;
  hasEOL?: boolean;
  transform?: number[];
  width?: number;
};

export type PdfPageText = { pageNum: number; text: string };

type PdfJsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

function resolvePdfWorkerSrc(): string {
  return pathToFileURL(
    path.join(
      process.cwd(),
      "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"
    )
  ).href;
}

let pdfjsReady: Promise<PdfJsModule> | null = null;

async function getPdfJs(): Promise<PdfJsModule> {
  if (!pdfjsReady) {
    pdfjsReady = (async () => {
      const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
      // Without this, getDocument waits forever for a worker Turbopack
      // cannot resolve (same hang as "Reading slides…" never finishing).
      pdfjsLib.GlobalWorkerOptions.workerSrc = resolvePdfWorkerSrc();
      return pdfjsLib;
    })();
  }
  return pdfjsReady;
}

/**
 * Rebuild slide/page text from PDF.js items using position, not hasEOL.
 * Words on one line get spaces; column gaps become tabs; y jumps become newlines.
 */
export function pdfItemsToText(items: PdfTextItem[]): string {
  let lastY: number | undefined;
  let lastEndX: number | undefined;
  let text = "";

  for (const item of items) {
    const str = item.str;
    if (!str) continue;
    const transform = item.transform;
    const x = Array.isArray(transform) ? Number(transform[4]) : NaN;
    const y = Array.isArray(transform) ? Number(transform[5]) : NaN;
    const width =
      typeof item.width === "number" && item.width > 0
        ? item.width
        : str.length * 4.5;

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      if (text.length > 0 && !text.endsWith("\n") && !text.endsWith(" ")) {
        text += " ";
      }
      text += str;
      if (item.hasEOL) text += "\n";
      continue;
    }

    if (lastY === undefined) {
      text += str;
    } else if (Math.abs(y - lastY) > 2) {
      text += `\n${str}`;
    } else {
      const gap = lastEndX === undefined ? 0 : x - lastEndX;
      if (gap > 18) text += `\t${str}`;
      else if (gap > 1.5) text += ` ${str}`;
      else text += str;
    }
    if (item.hasEOL && !text.endsWith("\n")) text += "\n";
    lastY = y;
    lastEndX = x + width;
  }

  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/ {2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function loadPdf(buffer: Buffer) {
  const pdfjsLib = await getPdfJs();
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
  }, OPEN_TIMEOUT_MS);
  try {
    return await Promise.race([
      loadingTask.promise,
      new Promise<never>((_, reject) => {
        setTimeout(
          () =>
            reject(
              new Error(
                "That PDF is taking too long to open. Try exporting it again, or upload a .pptx."
              )
            ),
          OPEN_TIMEOUT_MS
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
    for (let start = 1; start <= cap; start += RENDER_BATCH_SIZE) {
      const end = Math.min(cap, start + RENDER_BATCH_SIZE - 1);
      const batch = await Promise.all(
        Array.from({ length: end - start + 1 }, (_, i) => {
          const pageNum = start + i;
          return (async () => {
            const page = await pdf.getPage(pageNum);
            try {
              const content = await page.getTextContent({
                disableNormalization: true,
              });
              return {
                pageNum,
                text: pdfItemsToText(content.items as PdfTextItem[]),
              };
            } finally {
              page.cleanup();
            }
          })();
        })
      );
      pages.push(...batch);
    }
    return { pages, numpages };
  } finally {
    await pdf.destroy().catch(() => {});
  }
}

export async function extractPdfText(buffer: Buffer): Promise<string> {
  try {
    const { pages } = await extractPdfPages(buffer);
    const chunks: string[] = [];
    let totalChars = 0;
    for (const page of pages) {
      chunks.push(page.text);
      totalChars += page.text.length;
      if (totalChars >= MAX_CHARS) break;
    }
    return chunks
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
