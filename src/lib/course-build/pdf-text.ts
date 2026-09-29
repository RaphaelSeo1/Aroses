import { layoutPageText, type TextItem } from "./pdf-layout.ts";
import type { SourcePage } from "./clean.ts";

type RawItem = { str: string; transform: number[]; width?: number };
type PdfPage = {
  getTextContent(opts: { normalizeWhitespace: boolean; disableCombineTextItems: boolean }): Promise<{ items: RawItem[] }>;
};
type PdfDoc = { numPages: number; getPage(n: number): Promise<PdfPage>; destroy(): void };

type PdfJs = { disableWorker: boolean; getDocument(data: Uint8Array): Promise<PdfDoc> };

// The same PDF.js build the rest of the app reads PDFs with.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFJS = require("pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js") as PdfJs;

const BATCH = 6;

function toItem(raw: RawItem): TextItem {
  const [a = 0, b = 0, c = 0, d = 0, x = 0, y = 0] = raw.transform;
  return {
    str: raw.str,
    x,
    y,
    width: Number.isFinite(raw.width) ? Number(raw.width) : raw.str.length * 0.5 * Math.hypot(a, b),
    fontSize: Math.hypot(c, d) || Math.hypot(a, b) || 10,
  };
}

/** Raw text per page, with tables rebuilt as markdown from item positions. */
export async function extractPdfPagesWithTables(buffer: Buffer): Promise<SourcePage[]> {
  PDFJS.disableWorker = true;
  const doc = await PDFJS.getDocument(new Uint8Array(buffer));
  try {
    const out: SourcePage[] = [];
    for (let start = 1; start <= doc.numPages; start += BATCH) {
      const nums = Array.from({ length: Math.min(BATCH, doc.numPages - start + 1) }, (_, i) => start + i);
      const texts = await Promise.all(
        nums.map(async (n) => {
          const page = await doc.getPage(n);
          const tc = await page.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: true });
          return layoutPageText(tc.items.map(toItem));
        })
      );
      nums.forEach((n, i) => out.push({ n, text: texts[i]! }));
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    return out;
  } finally {
    try {
      doc.destroy();
    } catch {
      // already closed
    }
  }
}
