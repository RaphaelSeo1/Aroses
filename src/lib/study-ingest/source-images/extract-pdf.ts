import type { RawSourceImage } from "@/lib/study-ingest/source-images/types";

const MAX_PDF_PAGES = 80;
const MAX_IMAGES = 30;
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

/** Best-effort embedded image extraction from PDF pages (JPEG/PNG streams). */
export async function extractPdfSourceImages(
  buffer: Buffer,
  sourceFileName: string
): Promise<RawSourceImage[]> {
  try {
    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const data = new Uint8Array(
      buffer.buffer,
      buffer.byteOffset,
      buffer.byteLength
    );
    const pdf = await pdfjsLib.getDocument({
      data,
      disableFontFace: true,
      useSystemFonts: false,
    }).promise;

    const out: RawSourceImage[] = [];
    const pageCount = Math.min(pdf.numPages, MAX_PDF_PAGES);

    for (let pageNum = 1; pageNum <= pageCount && out.length < MAX_IMAGES; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const ops = await page.getOperatorList();
      const seenOnPage = new Set<string>();

      for (let i = 0; i < ops.fnArray.length; i++) {
        if (ops.fnArray[i] !== pdfjsLib.OPS.paintImageXObject) continue;
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

        out.push({
          buffer: raw,
          mimeType,
          fileName: `page-${pageNum}-${out.length + 1}.${mimeType === "image/png" ? "png" : "jpg"}`,
          sourceFileName,
          label: `Page ${pageNum}`,
          anchorType: "page",
          anchorIndex: pageNum,
        });

        if (out.length >= MAX_IMAGES) break;
      }

      page.cleanup();
    }

    await pdf.destroy().catch(() => {});
    return out;
  } catch (e) {
    console.warn("[extractPdfSourceImages]", e);
    return [];
  }
}
