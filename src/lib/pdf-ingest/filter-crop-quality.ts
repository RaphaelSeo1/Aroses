import { createCanvas, loadImage } from "@napi-rs/canvas";
import { inkProjections } from "@/lib/figure-orientation";
import {
  shouldKeepFigureCaption,
} from "@/lib/pdf-ingest/filter-figure-caption";

export function isStripCropAspect(width: number, height: number): boolean {
  if (width < 12 || height < 12) return true;
  const ratio = width / height;
  return ratio > 2.6 || ratio < 0.32;
}

export function isTooSmallCrop(width: number, height: number): boolean {
  return width * height < 12_000;
}

function countProjectionPeaks(ink: number[]): number {
  if (ink.length < 3) return 0;
  const max = Math.max(...ink, 1);
  const threshold = max * 0.12;
  let peaks = 0;
  for (let i = 1; i < ink.length - 1; i++) {
    if (
      ink[i]! >= threshold &&
      ink[i]! >= ink[i - 1]! &&
      ink[i]! >= ink[i + 1]!
    ) {
      peaks++;
    }
  }
  return peaks;
}

function imageIsTableGrid(
  data: Uint8ClampedArray,
  sw: number,
  sh: number
): boolean {
  const { rowInk, colInk } = inkProjections(data, sw, sh);
  const rowPeaks = countProjectionPeaks(rowInk);
  const colPeaks = countProjectionPeaks(colInk);
  if (colPeaks >= 3 && rowPeaks >= 2) return true;
  return false;
}

export {
  isJunkAssetCaption,
  isTableLikeCaption,
  isTextHeavyFigureCaption,
  shouldKeepFigureCaption,
} from "@/lib/pdf-ingest/filter-figure-caption";

/** Heuristic: tiny or near-empty PNG crops (failed font / icon renders). */
export function isLikelyCorruptCropPng(buffer: Buffer): boolean {
  if (!buffer || buffer.length < 2_500) return true;
  if (buffer[0] !== 0x89 || buffer[1] !== 0x50) return true;
  if (buffer.length < 12_000) {
    let same = 0;
    const sample = Math.min(buffer.length, 512);
    const first = buffer[0];
    for (let i = 1; i < sample; i++) {
      if (buffer[i] === first) same++;
    }
    if (same / sample > 0.85) return true;
  }
  return false;
}

export function maxFiguresPerPage(): number {
  const raw = process.env.PDF_INGEST_MAX_FIGURES_PER_PAGE?.trim();
  const n = raw ? Number.parseInt(raw, 10) : 4;
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 6) : 4;
}

const MIN_USABLE_CROP_QUALITY = 0.3;

export function bboxArea(b: {
  ymin: number;
  xmin: number;
  ymax: number;
  xmax: number;
}): number {
  return Math.max(0, b.ymax - b.ymin) * Math.max(0, b.xmax - b.xmin);
}

export function bboxAspectRatio(b: {
  ymin: number;
  xmin: number;
  ymax: number;
  xmax: number;
}): number {
  const w = Math.max(1, b.xmax - b.xmin);
  const h = Math.max(1, b.ymax - b.ymin);
  return h / w;
}

export function isOversizedBbox(b: {
  ymin: number;
  xmin: number;
  ymax: number;
  xmax: number;
}): boolean {
  return bboxArea(b) > 850_000;
}

export function isStripBbox(b: {
  ymin: number;
  xmin: number;
  ymax: number;
  xmax: number;
}): boolean {
  const aspect = bboxAspectRatio(b);
  return aspect > 2.1 || aspect < 0.38;
}

export function isUndersizedBbox(b: {
  ymin: number;
  xmin: number;
  ymax: number;
  xmax: number;
}): boolean {
  return bboxArea(b) < 22_000;
}

/** Wide shallow bbox — usually a multi-column table row block, not a diagram. */
export function isWideTableBbox(b: {
  ymin: number;
  xmin: number;
  ymax: number;
  xmax: number;
}): boolean {
  const w = b.xmax - b.xmin;
  const h = b.ymax - b.ymin;
  if (w < 620 || h < 120) return false;
  return w / Math.max(1, h) > 1.15 && w >= 680;
}

export function shouldKeepVisionFigureHit(hit: {
  caption: string;
  bbox: {
    ymin: number;
    xmin: number;
    ymax: number;
    xmax: number;
  };
}): boolean {
  if (!shouldKeepFigureCaption(hit.caption)) return false;
  if (isOversizedBbox(hit.bbox)) return false;
  if (isStripBbox(hit.bbox)) return false;
  if (isUndersizedBbox(hit.bbox)) return false;
  if (isWideTableBbox(hit.bbox)) return false;
  return true;
}

/** Count ☒-like cells in a region (ignore slide margins / side icon columns). */
function countTofuCells(
  pixels: Uint8ClampedArray,
  sw: number,
  sh: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  cell: number
): { tofuCells: number; totalCells: number } {
  let tofuCells = 0;
  let totalCells = 0;
  for (let cy = y0; cy < y1; cy += cell) {
    for (let cx = x0; cx < x1; cx += cell) {
      let dark = 0;
      let total = 0;
      for (let y = cy; y < Math.min(cy + cell, sh); y++) {
        for (let x = cx; x < Math.min(cx + cell, sw); x++) {
          const i = (y * sw + x) * 4;
          const r = pixels[i]!;
          const g = pixels[i + 1]!;
          const b = pixels[i + 2]!;
          total++;
          if (r < 120 && g < 120 && b < 120) dark++;
        }
      }
      if (total === 0) continue;
      totalCells++;
      const ratio = dark / total;
      if (ratio >= 0.06 && ratio <= 0.42) tofuCells++;
    }
  }
  return { tofuCells, totalCells };
}

/**
 * Reject only when the diagram CENTER is ☒-heavy (edge chrome / side columns
 * with missing glyphs do not disqualify an otherwise good anatomy crop).
 */
export async function isLikelyMissingGlyphCropPng(
  buffer: Buffer
): Promise<boolean> {
  try {
    const image = await loadImage(buffer);
    const w = image.width;
    const h = image.height;
    if (w < 24 || h < 24) return false;

    const sw = Math.min(160, w);
    const sh = Math.min(160, h);
    const canvas = createCanvas(sw, sh);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, sw, sh);
    ctx.drawImage(image, 0, 0, sw, sh);
    const pixels = ctx.getImageData(0, 0, sw, sh).data;

    const cell = 10;
    const mx = Math.floor(sw * 0.12);
    const my = Math.floor(sh * 0.1);
    const { tofuCells, totalCells } = countTofuCells(
      pixels,
      sw,
      sh,
      mx,
      my,
      sw - mx,
      sh - my,
      cell
    );
    if (totalCells === 0) return false;
    const tofuRatio = tofuCells / totalCells;
    // All-labels-are-☒ flowcharts (center filled with placeholder tiles).
    if (tofuCells >= 10 && tofuRatio >= 0.14) return true;
    if (tofuCells >= 7 && tofuRatio >= 0.2) return true;
    return false;
  } catch {
    return false;
  }
}

/** 0 = unusable; 1 = clean diagram crop. Glyph check optional when already run. */
export async function scoreCropQuality(
  buffer: Buffer,
  opts?: { skipGlyphCheck?: boolean }
): Promise<number> {
  if (isLikelyCorruptCropPng(buffer)) return 0;
  if (
    !opts?.skipGlyphCheck &&
    (await isLikelyMissingGlyphCropPng(buffer))
  ) {
    return 0;
  }

  try {
    const image = await loadImage(buffer);
    const w = image.width;
    const h = image.height;
    if (w < 24 || h < 24) return 0;

    const sw = Math.min(128, w);
    const sh = Math.min(128, h);
    const canvas = createCanvas(sw, sh);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0, sw, sh);
    const pixels = ctx.getImageData(0, 0, sw, sh).data;

    let white = 0;
    let dark = 0;
    const buckets = new Set<string>();
    const total = sw * sh;

    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i]!;
      const g = pixels[i + 1]!;
      const b = pixels[i + 2]!;
      if (r > 235 && g > 235 && b > 235) white++;
      else if (r < 100 && g < 100 && b < 100) dark++;
      buckets.add(
        `${Math.floor(r / 48)},${Math.floor(g / 48)},${Math.floor(b / 48)}`
      );
    }

    const darkRatio = dark / total;
    const whiteRatio = white / total;
    if (darkRatio < 0.008) return 0.1;
    if (whiteRatio > 0.97 && darkRatio < 0.02) return 0.1;

    let score = 0.45;
    if (darkRatio >= 0.015 && darkRatio <= 0.28) score += 0.2;
    if (buckets.size >= 12) score += 0.15;
    if (buckets.size >= 20) score += 0.1;
    if (w * h >= 40_000) score += 0.1;
    return Math.min(1, score);
  } catch {
    return 0;
  }
}

export function isUsableCropQuality(score: number): boolean {
  return score >= MIN_USABLE_CROP_QUALITY;
}

export async function isLikelyTextOrIconCropPng(buffer: Buffer): Promise<boolean> {
  if (isLikelyCorruptCropPng(buffer)) return true;
  if (await isLikelyMissingGlyphCropPng(buffer)) return true;
  try {
    const image = await loadImage(buffer);
    const w = image.width;
    const h = image.height;
    if (w < 24 || h < 24) return true;

    const aspect = h / w;
    if (aspect > 2.6 || aspect < 0.18) return true;

    const sw = Math.min(96, w);
    const sh = Math.min(96, h);
    const canvas = createCanvas(sw, sh);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0, sw, sh);
    const pixels = ctx.getImageData(0, 0, sw, sh).data;

    let white = 0;
    let dark = 0;
    const buckets = new Map<string, number>();
    const total = sw * sh;

    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i]!;
      const g = pixels[i + 1]!;
      const b = pixels[i + 2]!;
      if (r > 235 && g > 235 && b > 235) white++;
      else if (r < 90 && g < 90 && b < 90) dark++;
      const key = `${Math.floor(r / 40)},${Math.floor(g / 40)},${Math.floor(b / 40)}`;
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }

    const area = w * h;
    const darkRatio = dark / total;
    const whiteRatio = white / total;

    // Tiny icon / checkbox tiles — not full diagrams.
    if (area < 12_000 && whiteRatio > 0.55 && darkRatio < 0.22) {
      return true;
    }
    // Narrow strips of bullet text (not square-ish diagrams).
    if (
      (aspect > 2.2 || aspect < 0.28) &&
      whiteRatio > 0.68 &&
      darkRatio > 0.02 &&
      darkRatio < 0.16
    ) {
      return true;
    }
    if (buckets.size < 8 && area < 8_000 && whiteRatio > 0.5) return true;
    return false;
  } catch {
    return true;
  }
}

/** Table grids belong in markdown — reject PNG crops with column/row rules. */
export async function isLikelyTableGridCropPng(buffer: Buffer): Promise<boolean> {
  try {
    const image = await loadImage(buffer);
    const w = image.width;
    const h = image.height;
    if (w < 24 || h < 24) return false;

    const sw = Math.min(220, w);
    const sh = Math.min(220, h);
    const canvas = createCanvas(sw, sh);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, sw, sh);
    ctx.drawImage(image, 0, 0, sw, sh);
    const pixels = ctx.getImageData(0, 0, sw, sh).data;
    return imageIsTableGrid(pixels, sw, sh);
  } catch {
    return false;
  }
}

export async function shouldKeepCroppedFigure(input: {
  buffer: Buffer;
  caption: string;
  bbox?: {
    ymin: number;
    xmin: number;
    ymax: number;
    xmax: number;
  };
  /** Skip strict bbox size gate (fallback band crops). */
  relaxedBbox?: boolean;
}): Promise<boolean> {
  if (!shouldKeepFigureCaption(input.caption)) return false;
  if (
    input.bbox &&
    !input.relaxedBbox &&
    !shouldKeepVisionFigureHit({
      caption: input.caption,
      bbox: input.bbox,
    })
  ) {
    return false;
  }
  if (await isLikelyMissingGlyphCropPng(input.buffer)) return false;
  if (await isLikelyTableGridCropPng(input.buffer)) return false;
  const quality = await scoreCropQuality(input.buffer, { skipGlyphCheck: true });
  return isUsableCropQuality(quality);
}
