import { createCanvas, loadImage } from "@napi-rs/canvas";
import {
  IDENTITY_MATRIX,
  concatTransform,
  transformPoint,
  userRectFromPoints,
  type Matrix6,
} from "@/lib/pdf-ingest/bbox-math";
import { extractStructuralCandidatesForPage } from "@/lib/pdf-ingest/extract-assets";
import {
  isLikelyMissingGlyphCropPng,
  isLikelyTableGridCropPng,
  isLikelyTextOrIconCropPng,
  scoreCropQuality,
} from "@/lib/pdf-ingest/filter-crop-quality";
import { loadPdfDocument } from "@/lib/study-ingest/source-images/render-pdf-page";
import { isChromeBox, repeatedBoxes, type Box, type FigureCandidate } from "./figures.ts";

const RENDER_WIDTH_PX = 1100;
const MAX_SCALE = 1.5;
const THUMB_SIDE_PX = 320;
const MAX_UPLOAD_SIDE_PX = 1100;
/** Pages with at least this many filled or stroked paths may hold a drawn diagram. */
const VECTOR_PAGE_PATHS = 25;
const MIN_IMAGE_AREA = 0.015;
const MAX_SCAN_PAGES = 200;
/** Crops checked per rendered page, largest first; the rest are never encoded. */
const MAX_CROPS_PER_PAGE = 6;
const MAX_CANDIDATES = 60;

export type FoundFigures = {
  candidates: FigureCandidate[];
  repeated: Box[];
  pagesRendered: number;
  /** True when the time budget ran out and later pages were skipped. */
  truncated: boolean;
};

/** pdfjs runs on the main thread here; yielding keeps the server answering requests. */
const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

// One scan per process at a time: each holds a parsed PDF and page canvases in memory.
let queue: Promise<unknown> = Promise.resolve();
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

type PdfPage = Awaited<ReturnType<Awaited<ReturnType<typeof loadPdfDocument>>["pdf"]["getPage"]>>;
type PageScan = { page: number; images: Box[]; paths: number };

async function scanPage(page: PdfPage, pageNum: number, OPS: Record<string, number>): Promise<PageScan> {
  const vp = page.getViewport({ scale: 1 });
  const ops = await page.getOperatorList();
  const images: Box[] = [];
  const stack: Matrix6[] = [];
  let ctm: Matrix6 = [...IDENTITY_MATRIX];
  let paths = 0;
  const paint = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageXObjectRepeat]);
  const commit = new Set([OPS.fill, OPS.eoFill, OPS.stroke, OPS.fillStroke, OPS.eoFillStroke, OPS.closeStroke]);
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
    } else if (commit.has(fn) || fn === OPS.constructPath) {
      paths++;
    } else if (paint.has(fn)) {
      const rect = userRectFromPoints([
        transformPoint(ctm, 0, 0),
        transformPoint(ctm, 1, 0),
        transformPoint(ctm, 0, 1),
        transformPoint(ctm, 1, 1),
      ]);
      if (!rect) continue;
      const a = vp.convertToViewportPoint(rect.x0, rect.y0);
      const b = vp.convertToViewportPoint(rect.x1, rect.y1);
      const x = Math.min(a[0]!, b[0]!) / vp.width;
      const y = Math.min(a[1]!, b[1]!) / vp.height;
      const w = Math.abs(b[0]! - a[0]!) / vp.width;
      const h = Math.abs(b[1]! - a[1]!) / vp.height;
      if (w * h >= 0.002) images.push({ x, y, w, h });
    }
  }
  return { page: pageNum, images, paths };
}

async function encode(buffer: Buffer, maxSide: number, mime: "image/png" | "image/jpeg"): Promise<Buffer> {
  const img = await loadImage(buffer);
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  if (scale === 1 && mime === "image/png") return buffer;
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return mime === "image/jpeg" ? canvas.toBuffer("image/jpeg", 82) : canvas.toBuffer("image/png");
}

const SHEET_COLS = 4;
const SHEET_CELL_PX = 256;

/** Numbered 4-column contact sheet for the vision check. */
export async function makeContactSheet(images: Buffer[], first: number): Promise<Buffer> {
  const rows = Math.max(1, Math.ceil(images.length / SHEET_COLS));
  const canvas = createCanvas(SHEET_COLS * SHEET_CELL_PX, rows * SHEET_CELL_PX);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const [i, buf] of images.entries()) {
    const x = (i % SHEET_COLS) * SHEET_CELL_PX;
    const y = Math.floor(i / SHEET_COLS) * SHEET_CELL_PX;
    const img = await loadImage(buf);
    const pad = 10;
    const s = Math.min((SHEET_CELL_PX - 2 * pad) / img.width, (SHEET_CELL_PX - 2 * pad) / img.height);
    const w = img.width * s;
    const h = img.height * s;
    ctx.drawImage(img, x + (SHEET_CELL_PX - w) / 2, y + (SHEET_CELL_PX - h) / 2, w, h);
    ctx.strokeStyle = "#999999";
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, SHEET_CELL_PX - 2, SHEET_CELL_PX - 2);
    const label = String(first + i);
    ctx.font = "bold 22px sans-serif";
    const lw = ctx.measureText(label).width + 12;
    ctx.fillStyle = "#d4145a";
    ctx.fillRect(x + 2, y + 2, lw, 28);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(label, x + 8, y + 24);
  }
  return canvas.toBuffer("image/jpeg", 80);
}

/** 64-bit difference hash: each bit says whether a pixel is brighter than its right neighbour. */
async function differenceHash(buffer: Buffer): Promise<string> {
  const img = await loadImage(buffer);
  const canvas = createCanvas(9, 8);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, 9, 8);
  const px = ctx.getImageData(0, 0, 9, 8).data;
  const lum = (x: number, y: number) => {
    const i = (y * 9 + x) * 4;
    return px[i]! * 0.299 + px[i + 1]! * 0.587 + px[i + 2]! * 0.114;
  };
  let hex = "";
  for (let y = 0; y < 8; y++) {
    let byte = 0;
    for (let x = 0; x < 8; x++) byte = (byte << 1) | (lum(x, y) > lum(x + 1, y) ? 1 : 0);
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

/** 0 for blank, low for nearly blank or flat, high for a real picture. */
async function rasterQuality(buffer: Buffer): Promise<number> {
  const img = await loadImage(buffer);
  const sw = Math.min(96, img.width);
  const sh = Math.min(96, img.height);
  const canvas = createCanvas(sw, sh);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, sw, sh);
  ctx.drawImage(img, 0, 0, sw, sh);
  const px = ctx.getImageData(0, 0, sw, sh).data;
  let ink = 0;
  const buckets = new Set<number>();
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i]!;
    const g = px[i + 1]!;
    const b = px[i + 2]!;
    if (r < 235 || g < 235 || b < 235) ink++;
    buckets.add(((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5));
  }
  const inkRatio = ink / (sw * sh);
  if (inkRatio < 0.005 || buckets.size < 2) return 0;
  if (inkRatio < 0.03 || buckets.size < 6) return 0.3;
  return Math.min(1, 0.6 + buckets.size / 60);
}

/**
 * Finds figure crops in a PDF without any AI. Every page's drawing commands
 * are scanned; only pages that draw a sizeable image or many paths are rendered.
 */
export function findPdfFigures(
  buffer: Buffer,
  opts: { maxRenderPages: number; timeBudgetMs: number; signal?: AbortSignal }
): Promise<FoundFigures> {
  return exclusive(() => findPdfFiguresNow(buffer, opts));
}

async function findPdfFiguresNow(
  buffer: Buffer,
  opts: { maxRenderPages: number; timeBudgetMs: number; signal?: AbortSignal }
): Promise<FoundFigures> {
  const deadline = Date.now() + opts.timeBudgetMs;
  let truncated = false;
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const OPS = pdfjsLib.OPS as unknown as Record<string, number>;
  const { pdf } = await loadPdfDocument(buffer);
  try {
    const scans: PageScan[] = [];
    const total = Math.min(pdf.numPages, MAX_SCAN_PAGES);
    // Scanning may use at most half the budget so rendering still gets time.
    const scanDeadline = Date.now() + opts.timeBudgetMs / 2;
    for (let n = 1; n <= total; n++) {
      if (opts.signal?.aborted) throw new Error("aborted");
      if (Date.now() > scanDeadline) {
        truncated = true;
        break;
      }
      const page = await pdf.getPage(n);
      try {
        scans.push(await scanPage(page, n, OPS));
      } catch {
        // One unreadable page doesn't stop the rest.
      } finally {
        page.cleanup();
      }
      await yieldToEventLoop();
    }

    const repeated = repeatedBoxes(new Map(scans.map((s) => [s.page, s.images])), total);
    const score = (s: PageScan) => {
      const img = s.images.filter((b) => !isChromeBox(b, repeated) && b.w * b.h >= MIN_IMAGE_AREA && b.w * b.h <= 0.8);
      const imgArea = img.reduce((a, b) => a + b.w * b.h, 0);
      return imgArea > 0 ? 1 + imgArea : s.paths >= VECTOR_PAGE_PATHS ? Math.min(1, s.paths / 200) : 0;
    };
    const toRender = scans
      .map((s) => ({ page: s.page, score: score(s) }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(0, opts.maxRenderPages))
      .map((s) => s.page)
      .sort((a, b) => a - b);

    const candidates: FigureCandidate[] = [];
    let pagesRendered = 0;
    for (const n of toRender) {
      if (opts.signal?.aborted) throw new Error("aborted");
      if (Date.now() > deadline || candidates.length >= MAX_CANDIDATES) {
        truncated = true;
        break;
      }
      await yieldToEventLoop();
      pagesRendered++;
      const page = await pdf.getPage(n);
      try {
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(MAX_SCALE, base.width > 0 ? RENDER_WIDTH_PX / base.width : MAX_SCALE);
        const viewport = page.getViewport({ scale });
        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        const context = canvas.getContext("2d");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({
          canvas: canvas as unknown as HTMLCanvasElement,
          canvasContext: context as unknown as CanvasRenderingContext2D,
          viewport,
        }).promise;
        const pagePng = canvas.toBuffer("image/jpeg", 90);
        const found = await extractStructuralCandidatesForPage({
          page,
          viewport: viewport as unknown as Parameters<typeof extractStructuralCandidatesForPage>[0]["viewport"],
          pagePng,
          pageNum: n,
          seenImageObjectIds: new Set(),
        });
        const crops = [...found.raster, ...found.vector]
          .sort((a, b) => b.pixelRect.w * b.pixelRect.h - a.pixelRect.w * a.pixelRect.h)
          .slice(0, MAX_CROPS_PER_PAGE);
        for (const c of crops) {
          if (candidates.length >= MAX_CANDIDATES) break;
          const crop = c.cropBuffer;
          const r = c.pixelRect;
          const origin = c.source === "structural_raster" ? "raster" : "vector";
          // Font checks only mean something for drawn regions; an embedded
          // image carries its own text as pixels.
          if (origin === "vector" && ((await isLikelyTextOrIconCropPng(crop)) || (await isLikelyMissingGlyphCropPng(crop)))) {
            continue;
          }
          const quality = origin === "raster" ? await rasterQuality(crop) : await scoreCropQuality(crop, { skipGlyphCheck: true });
          if (quality <= 0) continue;
          const mime = origin === "raster" ? "image/jpeg" : "image/png";
          candidates.push({
            page: n,
            origin,
            box: { x: r.x / canvas.width, y: r.y / canvas.height, w: r.w / canvas.width, h: r.h / canvas.height },
            width: r.w,
            height: r.h,
            image: await encode(crop, MAX_UPLOAD_SIDE_PX, mime),
            mime,
            thumb: await encode(crop, THUMB_SIDE_PX, "image/jpeg"),
            quality,
            tableGrid: await isLikelyTableGridCropPng(crop),
            hash: await differenceHash(crop),
          });
        }
      } finally {
        page.cleanup();
      }
    }
    return { candidates, repeated, pagesRendered, truncated };
  } finally {
    await pdf.destroy().catch(() => {});
  }
}
