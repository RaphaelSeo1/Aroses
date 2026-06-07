import { loadPdfDocument } from "@/lib/study-ingest/source-images/render-pdf-page";
import type { RawSourceImage } from "@/lib/study-ingest/source-images/types";

const MAX_PDF_PAGES = 150;
const MAX_IMAGES = 150;
const MIN_BYTES = 3_500;

function isJpeg(buf: Buffer): boolean {
  return buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8;
}

function isPng(buf: Buffer): boolean {
  return (
    buf.length > 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  );
}

function isPaintImageOp(
  pdfjsLib: { OPS: Record<string, number> },
  fn: number
): boolean {
  const ops = pdfjsLib.OPS;
  return (
    fn === ops.paintImageXObject ||
    fn === ops.paintJpegXObject ||
    fn === ops.paintImageMaskXObject
  );
}

async function extractImagesFromPage(
  page: {
    getOperatorList: () => Promise<{
      fnArray: number[];
      argsArray: unknown[][];
    }>;
    objs: {
      get: (name: string, cb: (obj: unknown) => void) => void;
    };
    cleanup: () => void;
  },
  pageNum: number,
  pdfjsLib: { OPS: Record<string, number> },
  sourceFileName: string,
  out: RawSourceImage[],
  globalCap: number
): Promise<void> {
  const ops = await page.getOperatorList();
  const seenOnPage = new Set<string>();
  let figOnPage = 0;

  for (let i = 0; i < ops.fnArray.length; i++) {
    if (out.length >= globalCap) break;
    if (!isPaintImageOp(pdfjsLib, ops.fnArray[i]!)) continue;
    const name = ops.argsArray[i]?.[0];
    if (typeof name !== "string" || seenOnPage.has(name)) continue;
    seenOnPage.add(name);

    const imgData = await new Promise<{
      data: Uint8Array;
      width: number;
      height: number;
    } | null>((resolve) => {
      page.objs.get(name, (obj: unknown) => {
        if (
          obj &&
          typeof obj === "object" &&
          "data" in obj &&
          obj.data instanceof Uint8Array
        ) {
          const o = obj as {
            data: Uint8Array;
            width?: number;
            height?: number;
          };
          resolve({
            data: o.data,
            width: typeof o.width === "number" ? o.width : 0,
            height: typeof o.height === "number" ? o.height : 0,
          });
          return;
        }
        resolve(null);
      });
    });

    if (!imgData || imgData.data.length < MIN_BYTES) continue;
    if (imgData.width > 0 && imgData.width < 48 && imgData.height < 48) {
      continue;
    }

    const raw = Buffer.from(imgData.data);
    let mimeType: string | null = null;
    if (isJpeg(raw)) mimeType = "image/jpeg";
    else if (isPng(raw)) mimeType = "image/png";
    else continue;

    figOnPage++;
    out.push({
      buffer: raw,
      mimeType,
      fileName: `page-${pageNum}-embed-${figOnPage}.${mimeType === "image/png" ? "png" : "jpg"}`,
      sourceFileName,
      label: `Figure on page ${pageNum}`,
      anchorType: "page",
      anchorIndex: pageNum,
    });
  }
}

/** Best-effort embedded raster extraction via PDF operator list (no vision bbox). */
export async function extractPdfSourceImages(
  buffer: Buffer,
  sourceFileName: string
): Promise<RawSourceImage[]> {
  return extractPdfSourceImagesForPages(buffer, sourceFileName);
}

/** Extract embedded JPEG/PNG XObjects for specific pages (structural, deterministic). */
export async function extractPdfSourceImagesForPages(
  buffer: Buffer,
  sourceFileName: string,
  pageNumbers?: number[]
): Promise<RawSourceImage[]> {
  try {
    const { pdf, pdfjsLib } = await loadPdfDocument(buffer);

    const out: RawSourceImage[] = [];
    const pageCount = pdf.numPages;
    const targets =
      pageNumbers && pageNumbers.length > 0
        ? [...new Set(pageNumbers)]
            .filter((p) => p >= 1 && p <= pageCount)
            .sort((a, b) => a - b)
            .slice(0, MAX_PDF_PAGES)
        : Array.from(
            { length: Math.min(pageCount, MAX_PDF_PAGES) },
            (_, i) => i + 1
          );

    for (const pageNum of targets) {
      if (out.length >= MAX_IMAGES) break;
      const page = await pdf.getPage(pageNum);
      try {
        await extractImagesFromPage(
          page,
          pageNum,
          pdfjsLib,
          sourceFileName,
          out,
          MAX_IMAGES
        );
      } finally {
        page.cleanup();
      }
    }

    await pdf.destroy().catch(() => {});
    return out;
  } catch (e) {
    console.warn("[extractPdfSourceImagesForPages]", e);
    return [];
  }
}
