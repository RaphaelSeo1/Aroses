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
import type { PageBox } from "./clean.ts";
import { FigureBudget, eachWithinBudget, spreadOrder, yieldToEventLoop } from "./figure-budget.ts";
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
  /** Small renders of the requested `tablePages`, for the page-level table check. */
  pageImages?: Array<{ page: number; image: Buffer }>;
};

/** Page renders for the table check: legible layout at about 1,000 image tokens each. */
const TABLE_PAGE_WIDTH_PX = 768;
/** Share of the figure budget the table-page renders may use. */
const TABLE_PAGE_BUDGET_SHARE = 0.2;


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

export type FindFiguresOptions = {
  maxRenderPages: number;
  timeBudgetMs: number;
  /**
   * Absolute end of the budget. Defaults to now + timeBudgetMs; set it
   * earlier to count time spent before the call (download, queue).
   */
  deadlineAt?: number;
  signal?: AbortSignal;
  /** Pages to render whole for the table check, in priority order. */
  tablePages?: TablePageRequest[];
};

/** A page for the table check and where its text-layer tables sit. */
export type TablePageRequest = { page: number; boxes?: PageBox[] };

/** Whole-page renders with legible text, within a share of the figure budget; failures just skip the page. */
async function renderTablePages(
  buffer: Buffer,
  pages: TablePageRequest[],
  budget: FigureBudget,
  signal: AbortSignal | undefined
): Promise<Array<{ page: number; image: Buffer }>> {
  const tableBudget = budget.portion(TABLE_PAGE_BUDGET_SHARE);
  let pdf: Awaited<ReturnType<typeof loadPdfDocument>>["pdf"] | null = null;
  try {
    const doc = (await loadPdfDocument(buffer, { outlineFonts: true })).pdf;
    pdf = doc;
    const wanted = pages.filter((p) => Number.isInteger(p.page) && p.page >= 1 && p.page <= doc.numPages);
    const done = await eachWithinBudget<TablePageRequest, { page: number; image: Buffer }>(wanted, tableBudget, signal, async (p, emit) => {
      const page = await doc.getPage(p.page);
      try {
        emit({ page: p.page, image: await renderTablePage(page, p.boxes ?? [], tableBudget) });
      } catch {
        // An unrenderable page keeps its text-layer decision.
      } finally {
        page.cleanup();
      }
    });
    return done.results;
  } catch (err) {
    if (signal?.aborted) throw err;
    return [];
  } finally {
    await pdf?.destroy().catch(() => {});
  }
}

/** The page with each text-layer table outlined in red, so vision judges the right area. */
async function renderTablePage(page: PdfPage, boxes: PageBox[], budget: FigureBudget): Promise<Buffer> {
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: base.width > 0 ? Math.min(2, TABLE_PAGE_WIDTH_PX / base.width) : 1 });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await budget.within(
    page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      canvasContext: context as unknown as CanvasRenderingContext2D,
      viewport,
    })
  );
  const pad = 6;
  context.strokeStyle = "#e0102f";
  context.lineWidth = 3;
  for (const b of boxes) {
    context.strokeRect(b.x * canvas.width - pad, b.y * canvas.height - pad, b.w * canvas.width + 2 * pad, b.h * canvas.height + 2 * pad);
  }
  return canvas.toBuffer("image/jpeg", 75);
}

/**
 * Finds figure crops in a PDF without any AI. Every page's drawing commands
 * are scanned; only pages that draw a sizeable image or many paths are
 * rendered. Stops at the deadline, including time spent queued behind another
 * scan, and returns what it found so far.
 */
export function findPdfFigures(buffer: Buffer, opts: FindFiguresOptions): Promise<FoundFigures> {
  const budget = new FigureBudget(opts.deadlineAt ?? Date.now() + opts.timeBudgetMs);
  return exclusive(() => findPdfFiguresNow(buffer, opts, budget));
}

async function findPdfFiguresNow(buffer: Buffer, opts: FindFiguresOptions, budget: FigureBudget): Promise<FoundFigures> {
  const signal = opts.signal;
  if (budget.expired) return { candidates: [], repeated: [], pagesRendered: 0, truncated: true };
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const OPS = pdfjsLib.OPS as unknown as Record<string, number>;
  const pageImages = opts.tablePages?.length ? await renderTablePages(buffer, opts.tablePages, budget, signal) : [];
  const { pdf } = await loadPdfDocument(buffer);
  try {
    const total = Math.min(pdf.numPages, MAX_SCAN_PAGES);
    // Scanning may use at most half the remaining budget so rendering still gets time.
    const scan = await eachWithinBudget<number, PageScan>(spreadOrder(total), budget.portion(0.5), signal, async (n, emit) => {
      const page = await pdf.getPage(n);
      try {
        emit(await scanPage(page, n, OPS));
      } catch {
        // One unreadable page doesn't stop the rest.
      } finally {
        page.cleanup();
      }
    });
    const scans = scan.results;

    const repeated = repeatedBoxes(new Map(scans.map((s) => [s.page, s.images])), scan.truncated ? scans.length : total);
    const score = (s: PageScan) => {
      const img = s.images.filter((b) => !isChromeBox(b, repeated) && b.w * b.h >= MIN_IMAGE_AREA && b.w * b.h <= 0.8);
      const imgArea = img.reduce((a, b) => a + b.w * b.h, 0);
      return imgArea > 0 ? 1 + imgArea : s.paths >= VECTOR_PAGE_PATHS ? Math.min(1, s.paths / 200) : 0;
    };
    // Best pages first, so a render cut short by the budget loses the weakest ones.
    const toRender = scans
      .map((s) => ({ page: s.page, score: score(s) }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score || a.page - b.page)
      .slice(0, Math.max(0, opts.maxRenderPages))
      .map((s) => s.page);

    const render = await eachWithinBudget<number, FigureCandidate>(
      toRender,
      budget,
      signal,
      async (n, emit) => {
        const page = await pdf.getPage(n);
        try {
          await renderPageCrops(page, n, budget, signal, emit);
        } finally {
          page.cleanup();
        }
      },
      { stopWhen: (found) => found.length >= MAX_CANDIDATES }
    );
    const candidates = render.results.slice(0, MAX_CANDIDATES).sort((a, b) => a.page - b.page);
    return {
      candidates,
      repeated,
      pagesRendered: render.processed,
      truncated: scan.truncated || render.truncated,
      pageImages,
    };
  } finally {
    await pdf.destroy().catch(() => {});
  }
}

/** Renders one page and emits its usable crops, largest first, checking the budget between each. */
async function renderPageCrops(
  page: PdfPage,
  n: number,
  budget: FigureBudget,
  signal: AbortSignal | undefined,
  emit: (c: FigureCandidate) => void
): Promise<void> {
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(MAX_SCALE, base.width > 0 ? RENDER_WIDTH_PX / base.width : MAX_SCALE);
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  // A heavy page can take seconds to draw; the render is cancelled at the deadline.
  await budget.within(
    page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      canvasContext: context as unknown as CanvasRenderingContext2D,
      viewport,
    })
  );
  budget.check(signal);
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
    budget.check(signal);
    await yieldToEventLoop();
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
    emit({
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
}
