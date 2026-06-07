import {
  expandPixelRect,
  IDENTITY_MATRIX,
  multiplyMatrix,
  parseMinMaxBBox,
  transformPoint,
  unionUserRects,
  userRectArea,
  userRectFromPoints,
  userRectToPixel,
  type Matrix6,
  type PixelRect,
  type UserRect,
  type ViewportLike,
} from "@/lib/pdf-ingest/bbox-math";
import { cropPngToPixelRect } from "@/lib/pdf-ingest/crop-png-rect";
import { loadPdfDocument } from "@/lib/study-ingest/source-images/render-pdf-page";

// ---------------------------------------------------------------------------
// Tunable clustering / filtering thresholds (adjust during QA)
// ---------------------------------------------------------------------------

/** Min width or height (px) for a kept crop — smaller → decorative. */
export const MIN_CROP_SIDE_PX = 64;

/** Padding around structural crops before PNG extract. */
export const CROP_PADDING_PX = 6;

/** Merge vector shapes/text when gap <= this × median glyph height. */
export const CLUSTER_GAP_FACTOR = 1.5;

/** Vector cluster needs at least this many filled/stroked rects. */
export const MIN_VECTOR_RECTS = 2;

/** Alternative: at least this many lines plus one rect. */
export const MIN_VECTOR_LINES = 2;
export const MIN_VECTOR_LINES_WITH_RECT = 1;

/** Skip clusters covering more than this fraction of page area (over-merge). */
export const MAX_CLUSTER_PAGE_FRACTION = 0.85;

/** Min cluster area as fraction of page (noise filter). */
export const MIN_CLUSTER_AREA_FRACTION = 0.02;

/** IoU vs markdown-table region to dedupe vector crop labeled table. */
export const TABLE_VECTOR_IOU_DEDUP = 0.6;

/** Min rects in a cluster to treat as table-shaped for dedup. */
export const TABLE_SHAPE_MIN_RECTS = 4;

// ---------------------------------------------------------------------------

export type AssetExtractionSource =
  | "structural_raster"
  | "structural_vector"
  | "vision_bbox";

export type StructuralCandidate = {
  pageNum: number;
  source: AssetExtractionSource;
  pixelRect: PixelRect;
  cropBuffer: Buffer;
  imageObjectId?: string;
  shapeCount?: number;
  lineCount?: number;
  rectCount?: number;
};

type ShapeKind = "rect" | "line" | "path";

type CollectedShape = {
  kind: ShapeKind;
  userRect: UserRect;
};

type TextBox = {
  userRect: UserRect;
  height: number;
};

function isStructuralCropsEnabled(): boolean {
  const raw = process.env.PDF_INGEST_STRUCTURAL_CROPS?.trim();
  if (raw === "0" || raw?.toLowerCase() === "false") return false;
  return true;
}

export function structuralCropsEnabled(): boolean {
  return isStructuralCropsEnabled();
}

function isPaintImageOp(ops: Record<string, number>, fn: number): boolean {
  return (
    fn === ops.paintImageXObject ||
    fn === ops.paintInlineImageXObject ||
    fn === ops.paintImageMaskXObject ||
    fn === ops.paintImageMaskXObjectGroup ||
    fn === ops.paintInlineImageXObjectGroup ||
    fn === ops.paintImageXObjectRepeat ||
    fn === ops.paintImageMaskXObjectRepeat ||
    fn === ops.paintSolidColorImageMask
  );
}

function isPathCommitOp(ops: Record<string, number>, fn: number): boolean {
  return (
    fn === ops.fill ||
    fn === ops.eoFill ||
    fn === ops.stroke ||
    fn === ops.fillStroke ||
    fn === ops.eoFillStroke ||
    fn === ops.closeFillStroke ||
    fn === ops.closeEOFillStroke ||
    fn === ops.closeStroke
  );
}

function imageUnitSquareUserRect(ctm: Matrix6): UserRect | null {
  const corners = [
    transformPoint(ctm, 0, 0),
    transformPoint(ctm, 1, 0),
    transformPoint(ctm, 0, 1),
    transformPoint(ctm, 1, 1),
  ];
  return userRectFromPoints(corners);
}

async function resolveImageObject(
  page: {
    objs: { get: (name: string, cb: (obj: unknown) => void) => void };
  },
  name: string
): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    page.objs.get(name, (obj: unknown) => {
      if (!obj || typeof obj !== "object") {
        resolve(null);
        return;
      }
      const o = obj as { width?: number; height?: number };
      resolve({
        width: typeof o.width === "number" ? o.width : 1,
        height: typeof o.height === "number" ? o.height : 1,
      });
    });
  });
}

/**
 * 1a. Raster assets from paintImage* ops + CTM → pixel crop.
 */
export async function extractStructuralRasterCandidates(input: {
  page: Awaited<ReturnType<Awaited<ReturnType<typeof loadPdfDocument>>["pdf"]["getPage"]>>;
  viewport: ViewportLike;
  pagePng: Buffer;
  pageNum: number;
  seenImageObjectIds: Set<string>;
}): Promise<StructuralCandidate[]> {
  const { page, viewport, pagePng, pageNum, seenImageObjectIds } = input;
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const OPS = pdfjsLib.OPS;
  const ops = await page.getOperatorList();

  const ctmStack: Matrix6[] = [];
  let ctm: Matrix6 = [...IDENTITY_MATRIX];
  const out: StructuralCandidate[] = [];

  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i]!;
    const args = ops.argsArray[i];

    if (fn === OPS.save) {
      ctmStack.push([...ctm]);
      continue;
    }
    if (fn === OPS.restore) {
      const prev = ctmStack.pop();
      if (prev) ctm = prev;
      continue;
    }
    if (fn === OPS.transform && Array.isArray(args) && args.length >= 6) {
      const m: Matrix6 = [
        Number(args[0]),
        Number(args[1]),
        Number(args[2]),
        Number(args[3]),
        Number(args[4]),
        Number(args[5]),
      ];
      if (m.every(Number.isFinite)) ctm = multiplyMatrix(ctm, m);
      continue;
    }

    if (!isPaintImageOp(OPS, fn)) continue;
    const name = args?.[0];
    if (typeof name !== "string") continue;

    if (seenImageObjectIds.has(name)) continue;

    const imgMeta = await resolveImageObject(page, name);
    const unit = imageUnitSquareUserRect(ctm);
    if (!unit) continue;

    const pixel = userRectToPixel(unit, viewport);
    if (pixel.w < MIN_CROP_SIDE_PX || pixel.h < MIN_CROP_SIDE_PX) continue;

    const padded = expandPixelRect(
      pixel,
      CROP_PADDING_PX,
      Math.ceil(viewport.width),
      Math.ceil(viewport.height)
    );
    const cropBuffer = await cropPngToPixelRect(pagePng, padded);
    if (!cropBuffer) continue;

    seenImageObjectIds.add(name);
    out.push({
      pageNum,
      source: "structural_raster",
      pixelRect: padded,
      cropBuffer,
      imageObjectId: name,
    });
    void imgMeta;
  }

  return out;
}

async function collectVectorShapesFromOps(
  page: Awaited<ReturnType<Awaited<ReturnType<typeof loadPdfDocument>>["pdf"]["getPage"]>>,
  pdfjsLib: typeof import("pdfjs-dist/legacy/build/pdf.mjs")
): Promise<CollectedShape[]> {
  const OPS = pdfjsLib.OPS;
  const ops = await page.getOperatorList();
  {
    const shapes: CollectedShape[] = [];
    const ctmStack: Matrix6[] = [];
    let ctm: Matrix6 = [...IDENTITY_MATRIX];
    let pendingPath: UserRect | null = null;
    let pendingKind: ShapeKind = "path";

    const commitPath = () => {
      if (!pendingPath) return;
      shapes.push({ kind: pendingKind, userRect: pendingPath });
      pendingPath = null;
    };

    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i]!;
      const args = ops.argsArray[i];

      if (fn === OPS.save) {
        ctmStack.push([...ctm]);
        continue;
      }
      if (fn === OPS.restore) {
        const prev = ctmStack.pop();
        if (prev) ctm = prev;
        continue;
      }
      if (fn === OPS.transform && Array.isArray(args) && args.length >= 6) {
        const m: Matrix6 = args.map(Number) as Matrix6;
        if (m.every(Number.isFinite)) ctm = multiplyMatrix(ctm, m);
        continue;
      }

      if (fn === OPS.rectangle && Array.isArray(args) && args.length >= 4) {
        const [x, y, w, h] = args.map(Number);
        if (![x, y, w, h].every(Number.isFinite)) continue;
        const corners = [
          transformPoint(ctm, x, y),
          transformPoint(ctm, x + w, y),
          transformPoint(ctm, x, y + h),
          transformPoint(ctm, x + w, y + h),
        ];
        pendingPath = userRectFromPoints(corners);
        pendingKind = "rect";
        continue;
      }

      if (fn === OPS.constructPath && Array.isArray(args) && args.length >= 3) {
        const minMax = parseMinMaxBBox(args[2]);
        if (minMax) {
          pendingPath = minMax;
          pendingKind = "path";
        }
        continue;
      }

      if (fn === OPS.moveTo && Array.isArray(args) && args.length >= 2) {
        const p = transformPoint(ctm, Number(args[0]), Number(args[1]));
        pendingPath = userRectFromPoints([p]);
        pendingKind = "line";
        continue;
      }

      if (fn === OPS.lineTo && Array.isArray(args) && args.length >= 2) {
        const p = transformPoint(ctm, Number(args[0]), Number(args[1]));
        if (pendingPath) {
          pendingPath = unionUserRects(pendingPath, {
            x0: p.x,
            y0: p.y,
            x1: p.x,
            y1: p.y,
          });
        } else {
          pendingPath = userRectFromPoints([p]);
        }
        pendingKind = "line";
        continue;
      }

      if (isPathCommitOp(OPS, fn)) {
        commitPath();
      }
    }
    commitPath();
    return shapes;
  }
}

async function extractTextBoxes(
  page: Awaited<ReturnType<Awaited<ReturnType<typeof loadPdfDocument>>["pdf"]["getPage"]>>
): Promise<TextBox[]> {
  const textContent = await page.getTextContent();
  const out: TextBox[] = [];
  for (const item of textContent.items) {
    if (!("str" in item) || typeof item.str !== "string" || !item.str.trim()) {
      continue;
    }
    const tr = item.transform;
    if (!Array.isArray(tr) || tr.length < 6) continue;
    const m: Matrix6 = [
      Number(tr[0]),
      Number(tr[1]),
      Number(tr[2]),
      Number(tr[3]),
      Number(tr[4]),
      Number(tr[5]),
    ];
    if (!m.every(Number.isFinite)) continue;
    const w = typeof item.width === "number" ? item.width : 0;
    const h = Math.hypot(m[2], m[3]) || Math.hypot(m[0], m[1]) || 12;
    const p0 = transformPoint(m, 0, 0);
    const p1 = transformPoint(m, w, 0);
    const p2 = transformPoint(m, 0, h);
    const p3 = transformPoint(m, w, h);
    const rect = userRectFromPoints([p0, p1, p2, p3]);
    if (!rect) continue;
    out.push({ userRect: rect, height: Math.max(4, h) });
  }
  return out;
}

function medianGlyphHeight(textBoxes: TextBox[]): number {
  if (textBoxes.length === 0) return 14;
  const heights = textBoxes.map((t) => t.height).sort((a, b) => a - b);
  return heights[Math.floor(heights.length / 2)] ?? 14;
}

function gapPx(glyphH: number, viewport: ViewportLike, pageUserH: number): number {
  const scale = viewport.height / Math.max(1, pageUserH);
  return CLUSTER_GAP_FACTOR * glyphH * scale;
}

function clusterShapes(
  shapes: CollectedShape[],
  textBoxes: TextBox[],
  viewport: ViewportLike,
  pageUserRect: UserRect
): {
  userRect: UserRect;
  rectCount: number;
  lineCount: number;
  pathCount: number;
}[] {
  const pageArea = userRectArea(pageUserRect);
  const glyphH = medianGlyphHeight(textBoxes);
  const gap = gapPx(glyphH, viewport, pageUserRect.y1 - pageUserRect.y0);

  type Item = { userRect: UserRect; isText: boolean; kind?: ShapeKind };
  const items: Item[] = [
    ...shapes.map((s) => ({
      userRect: s.userRect,
      isText: false,
      kind: s.kind,
    })),
  ];

  const parent = items.map((_, i) => i);
  const find = (i: number): number => {
    if (parent[i] !== i) parent[i] = find(parent[i]!);
    return parent[i]!;
  };
  const unite = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  const gapUser = gap / Math.max(0.01, viewport.height / (pageUserRect.y1 - pageUserRect.y0));

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i]!.userRect;
      const b = items[j]!.userRect;
      const dx = Math.max(0, Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1));
      const dy = Math.max(0, Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1));
      if (dx <= gapUser && dy <= gapUser) unite(i, j);
    }
  }

  for (const t of textBoxes) {
    let best = -1;
    for (let i = 0; i < items.length; i++) {
      const s = items[i]!.userRect;
      const cx = (t.userRect.x0 + t.userRect.x1) / 2;
      const cy = (t.userRect.y0 + t.userRect.y1) / 2;
      if (cx >= s.x0 - gapUser && cx <= s.x1 + gapUser && cy >= s.y0 - gapUser && cy <= s.y1 + gapUser) {
        best = i;
        break;
      }
    }
    if (best >= 0) {
      items[best]!.userRect = unionUserRects(items[best]!.userRect, t.userRect);
    }
  }

  const groups = new Map<number, { rects: UserRect[]; kinds: ShapeKind[] }>();
  for (let i = 0; i < items.length; i++) {
    const r = find(i);
    const g = groups.get(r) ?? { rects: [], kinds: [] };
    g.rects.push(items[i]!.userRect);
    if (items[i]!.kind) g.kinds.push(items[i]!.kind!);
    groups.set(r, g);
  }

  type ClusterInfo = {
    userRect: UserRect;
    rectCount: number;
    lineCount: number;
    pathCount: number;
  };

  const clusters: ClusterInfo[] = [];
  for (const g of groups.values()) {
    let merged = g.rects[0]!;
    for (let i = 1; i < g.rects.length; i++) {
      merged = unionUserRects(merged, g.rects[i]!);
    }
    const areaFrac = userRectArea(merged) / Math.max(1, pageArea);
    if (areaFrac > MAX_CLUSTER_PAGE_FRACTION) continue;
    if (areaFrac < MIN_CLUSTER_AREA_FRACTION) continue;

    const rectCount = g.kinds.filter((k) => k === "rect").length;
    const lineCount = g.kinds.filter((k) => k === "line").length;
    const pathCount = g.kinds.filter((k) => k === "path").length;
    const shapeCount = rectCount + pathCount;

    const ok =
      rectCount >= MIN_VECTOR_RECTS ||
      shapeCount >= MIN_VECTOR_RECTS ||
      (lineCount >= MIN_VECTOR_LINES && rectCount >= MIN_VECTOR_LINES_WITH_RECT);
    if (!ok) continue;

    clusters.push({ userRect: merged, rectCount, lineCount, pathCount });
  }

  return clusters;
}

/**
 * 1b. Vector clusters from operator list + text positions → pixel crops.
 */
export async function extractStructuralVectorCandidates(input: {
  page: Awaited<ReturnType<Awaited<ReturnType<typeof loadPdfDocument>>["pdf"]["getPage"]>>;
  viewport: ViewportLike;
  pagePng: Buffer;
  pageNum: number;
}): Promise<{ candidates: StructuralCandidate[]; tableLikeRegions: PixelRect[] }> {
  const { page, viewport, pagePng, pageNum } = input;
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const viewportRaw = page.getViewport({ scale: viewport.width / page.getViewport({ scale: 1 }).width });

  const pageUser: UserRect = {
    x0: 0,
    y0: 0,
    x1: viewportRaw.width / viewportRaw.scale,
    y1: viewportRaw.height / viewportRaw.scale,
  };

  const [shapes, textBoxes] = await Promise.all([
    collectVectorShapesFromOps(page, pdfjsLib),
    extractTextBoxes(page),
  ]);

  const clusters = clusterShapes(shapes, textBoxes, viewport, pageUser);
  const candidates: StructuralCandidate[] = [];
  const tableLikeRegions: PixelRect[] = [];

  for (const cluster of clusters) {
    const pixel = userRectToPixel(cluster.userRect, viewport);
    if (pixel.w < MIN_CROP_SIDE_PX || pixel.h < MIN_CROP_SIDE_PX) continue;

    const padded = expandPixelRect(
      pixel,
      CROP_PADDING_PX,
      Math.ceil(viewport.width),
      Math.ceil(viewport.height)
    );
    const cropBuffer = await cropPngToPixelRect(pagePng, padded);
    if (!cropBuffer) continue;

    if (cluster.rectCount >= TABLE_SHAPE_MIN_RECTS) {
      tableLikeRegions.push(padded);
    }

    candidates.push({
      pageNum,
      source: "structural_vector",
      pixelRect: padded,
      cropBuffer,
      shapeCount: cluster.rectCount + cluster.pathCount,
      rectCount: cluster.rectCount,
      lineCount: cluster.lineCount,
    });
  }

  return { candidates, tableLikeRegions };
}

export type PageStructuralExtraction = {
  pageNum: number;
  raster: StructuralCandidate[];
  vector: StructuralCandidate[];
  tableLikeRegions: PixelRect[];
};

/**
 * Run 1a + 1b for one rendered page (PNG + PDF page object).
 */
export async function extractStructuralCandidatesForPage(input: {
  page: Awaited<ReturnType<Awaited<ReturnType<typeof loadPdfDocument>>["pdf"]["getPage"]>>;
  viewport: ViewportLike;
  pagePng: Buffer;
  pageNum: number;
  seenImageObjectIds: Set<string>;
}): Promise<PageStructuralExtraction> {
  if (!isStructuralCropsEnabled()) {
    return {
      pageNum: input.pageNum,
      raster: [],
      vector: [],
      tableLikeRegions: [],
    };
  }

  const raster = await extractStructuralRasterCandidates(input);
  const { candidates: vector, tableLikeRegions } =
    await extractStructuralVectorCandidates(input);

  return {
    pageNum: input.pageNum,
    raster,
    vector,
    tableLikeRegions,
  };
}
