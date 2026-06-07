import path from "path";
import { pathToFileURL } from "url";
import { createCanvas } from "@napi-rs/canvas";
import type { RawSourceImage } from "@/lib/study-ingest/source-images/types";

const MAX_RENDER_WIDTH_PX = 1_400;
const DEFAULT_SCALE = 1.75;
const MIN_PNG_BYTES = 4_000;

export type RenderedPdfPage = {
  pageNum: number;
  buffer: Buffer;
};

type PdfJsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

/** Absolute file:// URL — Turbopack breaks relative ./pdf.worker.mjs imports. */
function resolvePdfWorkerSrc(): string {
  return pathToFileURL(
    path.join(
      process.cwd(),
      "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"
    )
  ).href;
}

let pdfjsReady: Promise<PdfJsModule> | null = null;

/** Load pdfjs-dist once with a worker path Turbopack/Next can resolve. */
async function getPdfJs(): Promise<PdfJsModule> {
  if (!pdfjsReady) {
    pdfjsReady = (async () => {
      const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
      pdfjsLib.GlobalWorkerOptions.workerSrc = resolvePdfWorkerSrc();
      return pdfjsLib;
    })();
  }
  return pdfjsReady;
}

/** Load a PDF document (shared by extract + render). */
export async function loadPdfDocument(buffer: Buffer) {
  const pdfjsLib = await getPdfJs();
  // Always copy — legacy pdf-parse PDF.js may detach the source ArrayBuffer.
  const data = new Uint8Array(Buffer.from(buffer));
  const pdf = await pdfjsLib.getDocument({
    data,
    // Fonts enabled so exported slide PDFs render text and vector labels.
    disableFontFace: false,
    useSystemFonts: true,
  }).promise;
  return { pdf, pdfjsLib };
}

/**
 * Render selected PDF pages to PNG (full-page screenshots). Used when embedded
 * raster extraction misses vector-heavy lecture slides.
 */
export async function renderPdfPagesToPng(
  buffer: Buffer,
  pageNumbers: number[],
  sourceFileName: string
): Promise<RawSourceImage[]> {
  if (pageNumbers.length === 0) return [];

  try {
    const { pdf } = await loadPdfDocument(buffer);
    const pageCount = pdf.numPages;
    const unique = [...new Set(pageNumbers)]
      .filter((p) => p >= 1 && p <= pageCount)
      .sort((a, b) => a - b);

    const out: RawSourceImage[] = [];

    for (const pageNum of unique) {
      const page = await pdf.getPage(pageNum);
      try {
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(
          DEFAULT_SCALE,
          base.width > 0 ? MAX_RENDER_WIDTH_PX / base.width : DEFAULT_SCALE
        );
        const viewport = page.getViewport({ scale });
        const canvas = createCanvas(
          Math.ceil(viewport.width),
          Math.ceil(viewport.height)
        );
        const context = canvas.getContext("2d");
        if (!context) continue;

        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);

        await page.render({
          canvas: canvas as unknown as HTMLCanvasElement,
          canvasContext: context as unknown as CanvasRenderingContext2D,
          viewport,
        }).promise;

        const png = canvas.toBuffer("image/png");
        if (png.length < MIN_PNG_BYTES) continue;

        out.push({
          buffer: png,
          mimeType: "image/png",
          fileName: `page-${pageNum}-render.png`,
          sourceFileName,
          label: `Page ${pageNum}`,
          anchorType: "page",
          anchorIndex: pageNum,
        });
      } finally {
        page.cleanup();
      }
    }

    await pdf.destroy().catch(() => {});
    return out;
  } catch (e) {
    console.warn("[renderPdfPagesToPng]", sourceFileName, e);
    return [];
  }
}

export async function getPdfPageCount(buffer: Buffer): Promise<number> {
  try {
    const { pdf } = await loadPdfDocument(buffer);
    const n = pdf.numPages;
    await pdf.destroy().catch(() => {});
    return n;
  } catch (e) {
    console.warn("[getPdfPageCount] failed", e);
    return 0;
  }
}
