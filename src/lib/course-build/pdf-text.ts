import {
  IDENTITY_MATRIX,
  concatTransform,
  transformPoint,
  userRectFromPoints,
  type Matrix6,
} from "@/lib/pdf-ingest/bbox-math";
import { isTableLine, layoutPageText, type Rect, type TextItem } from "./pdf-layout.ts";
import type { SourcePage } from "./clean.ts";

type RawItem = { str: string; transform: number[]; width?: number };
type OperatorList = { fnArray: number[]; argsArray: unknown[] };
type PdfPage = {
  view?: number[];
  getTextContent(opts: { normalizeWhitespace: boolean; disableCombineTextItems: boolean }): Promise<{ items: RawItem[] }>;
  getOperatorList(): Promise<OperatorList>;
  cleanup?(): void;
};
type PdfDoc = { numPages: number; getPage(n: number): Promise<PdfPage>; destroy(): void };

type PdfJs = {
  PDFJS: { disableWorker: boolean; disableFontFace: boolean };
  OPS: Record<string, number>;
  getDocument(src: { data: Uint8Array; nativeImageDecoderSupport: string }): Promise<PdfDoc>;
};

// The same PDF.js build the rest of the app reads PDFs with.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFJS = require("pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js") as PdfJs;

const BATCH = 6;
/** Pictures covering more of the page than this are backgrounds or scans, not figures. */
const BACKGROUND_SHARE = 0.5;
/** Pages whose drawing commands are read for picture areas, per file. */
const MAX_FIGURE_SCANS = 150;
const FIGURE_SCAN_MS = 5_000;

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

/**
 * Where the page paints pictures, in the same coordinates as its text.
 * Transforms compose as the PDF defines them (`concatTransform`), so pages
 * that start with a scale or flip, as browser-printed PDFs do, come out right.
 */
async function figureAreas(page: PdfPage): Promise<Rect[]> {
  const OPS = PDFJS.OPS;
  const ops = await page.getOperatorList();
  const [vx0 = 0, vy0 = 0, vx1 = 0, vy1 = 0] = page.view ?? [];
  const pageArea = Math.abs((vx1 - vx0) * (vy1 - vy0));
  const paint = new Set(
    [OPS.paintImageXObject, OPS.paintJpegXObject, OPS.paintInlineImageXObject, OPS.paintImageXObjectRepeat].filter(
      (n) => n != null
    )
  );
  const out: Rect[] = [];
  const stack: Matrix6[] = [];
  let ctm: Matrix6 = [...IDENTITY_MATRIX];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i]!;
    const args = ops.argsArray[i];
    if (fn === OPS.save) stack.push([...ctm]);
    else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.transform && Array.isArray(args) && args.length >= 6) {
      const m = args.slice(0, 6).map(Number) as Matrix6;
      if (m.every(Number.isFinite)) ctm = concatTransform(ctm, m);
    } else if (fn === OPS.paintFormXObjectBegin) {
      stack.push([...ctm]);
      const raw = Array.isArray(args) ? (args[0] as ArrayLike<number> | null) : null;
      const m = raw && raw.length >= 6 ? (Array.from(raw).slice(0, 6).map(Number) as Matrix6) : null;
      if (m?.every(Number.isFinite)) ctm = concatTransform(ctm, m);
    } else if (fn === OPS.paintFormXObjectEnd) {
      ctm = stack.pop() ?? ctm;
    } else if (paint.has(fn)) {
      const r = userRectFromPoints([
        transformPoint(ctm, 0, 0),
        transformPoint(ctm, 1, 0),
        transformPoint(ctm, 0, 1),
        transformPoint(ctm, 1, 1),
      ]);
      if (!r) continue;
      if (pageArea > 0 && (r.x1 - r.x0) * (r.y1 - r.y0) >= pageArea * BACKGROUND_SHARE) continue;
      out.push(r);
    }
  }
  return out;
}

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      }
    );
  });
}

/** Raw text per page, with tables rebuilt as markdown from item positions. */
export async function extractPdfPagesWithTables(buffer: Buffer): Promise<SourcePage[]> {
  PDFJS.PDFJS.disableWorker = true;
  // Only positions are read from drawing commands; nothing is rendered, so no font loading.
  PDFJS.PDFJS.disableFontFace = true;
  const doc = await PDFJS.getDocument({ data: new Uint8Array(buffer), nativeImageDecoderSupport: "none" });
  let scans = 0;
  try {
    const out: SourcePage[] = [];
    for (let start = 1; start <= doc.numPages; start += BATCH) {
      const nums = Array.from({ length: Math.min(BATCH, doc.numPages - start + 1) }, (_, i) => start + i);
      const texts = await Promise.all(
        nums.map(async (n) => {
          const page = await doc.getPage(n);
          const tc = await page.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: true });
          const items = tc.items.map(toItem);
          const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = page.view ?? [];
          const box = x1 > x0 && y1 > y0 ? { x0, y0, x1, y1 } : undefined;
          let text = layoutPageText(items, { page: box });
          // Picture areas are read only where the text formed a table, to check it isn't a figure's labels.
          if (scans < MAX_FIGURE_SCANS && text.split("\n").some(isTableLine)) {
            scans++;
            const figures: Rect[] = await withTimeout(figureAreas(page), FIGURE_SCAN_MS, []);
            if (figures.length) text = layoutPageText(items, { figures, page: box });
          }
          page.cleanup?.();
          return text;
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
