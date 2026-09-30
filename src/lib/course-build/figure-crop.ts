import { createCanvas, loadImage } from "@napi-rs/canvas";
import type { Box } from "./figures.ts";

const NEAR_WHITE = 246;
const NEAR_BLACK = 42;
/** Ignore a margin this small so a tight crop is not re-encoded. */
const MARGIN_PX = 4;
/** Keep a little of the surrounding paper so anti-aliased edges survive. */
const PAD_PX = 6;
/** A mark smaller than this is noise, not a figure. */
const MIN_INK_PX = 48;

export type PreparedCrop = { buffer: Buffer; box: Box };

type Frame = { data: Uint8ClampedArray; width: number; height: number };

function lumaGap(r: number, g: number, b: number): number {
  return Math.max(r, g, b) - Math.min(r, g, b);
}

function isPaper(r: number, g: number, b: number): boolean {
  return r >= NEAR_WHITE && g >= NEAR_WHITE && b >= NEAR_WHITE;
}

function isInk(r: number, g: number, b: number): boolean {
  return !isPaper(r, g, b);
}

type Region = { white: number; black: number; chroma: number; n: number };

function regionStats(frame: Frame, x0: number, y0: number, x1: number, y1: number): Region {
  let white = 0;
  let black = 0;
  let chroma = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * frame.width + x) * 4;
      const r = frame.data[i]!;
      const g = frame.data[i + 1]!;
      const b = frame.data[i + 2]!;
      n++;
      if (lumaGap(r, g, b) > 28 && Math.max(r, g, b) > 48) chroma++;
      else if (isPaper(r, g, b)) white++;
      else if (r <= NEAR_BLACK && g <= NEAR_BLACK && b <= NEAR_BLACK) black++;
    }
  }
  return { white, black, chroma, n };
}

/**
 * A QR or barcode module on a scan: dense black, almost no color. JPEG
 * edges are gray, so the box is not only pure black and white.
 */
function isEdgeCode(stats: Region): boolean {
  if (stats.n === 0) return false;
  const white = stats.white / stats.n;
  const black = stats.black / stats.n;
  const chroma = stats.chroma / stats.n;
  return chroma < 0.05 && black > 0.3 && white + black > 0.8;
}

function isNearBlack(r: number, g: number, b: number): boolean {
  return r <= NEAR_BLACK && g <= NEAR_BLACK && b <= NEAR_BLACK && lumaGap(r, g, b) <= 28;
}

/** Clears non-colored pixels. Colored drawing under a mark is left in place. */
function blankPaperAndBlack(frame: Frame, x0: number, y0: number, x1: number, y1: number): void {
  const left = Math.max(0, x0);
  const top = Math.max(0, y0);
  const right = Math.min(frame.width, x1);
  const bottom = Math.min(frame.height, y1);
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const i = (y * frame.width + x) * 4;
      const r = frame.data[i]!;
      const g = frame.data[i + 1]!;
      const b = frame.data[i + 2]!;
      if (lumaGap(r, g, b) > 28 && Math.max(r, g, b) > 48) continue;
      frame.data[i] = 255;
      frame.data[i + 1] = 255;
      frame.data[i + 2] = 255;
      frame.data[i + 3] = 255;
    }
  }
}

/**
 * Clears a QR or barcode glued to the edge of a colored figure. The modules
 * are separate black blobs, so each blob is judged on its own. Letters and
 * line drawings stay: a blob has to be large, dense, and on the paper edge.
 */
function blankEdgeMarks(frame: Frame): boolean {
  const { width, height, data } = frame;
  const cx0 = Math.round(width * 0.25);
  const cy0 = Math.round(height * 0.25);
  const center = regionStats(frame, cx0, cy0, Math.round(width * 0.75), Math.round(height * 0.75));
  if (center.n === 0 || center.chroma / center.n < 0.06) return false;

  const seen = new Uint8Array(width * height);
  const stack: number[] = [];
  let blanked = false;
  for (let start = 0; start < width * height; start++) {
    if (seen[start]) continue;
    const si = start * 4;
    if (!isNearBlack(data[si]!, data[si + 1]!, data[si + 2]!)) continue;
    let n = 0;
    let x0 = width;
    let y0 = height;
    let x1 = 0;
    let y1 = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length > 0) {
      const p = stack.pop()!;
      const x = p % width;
      const y = (p - x) / width;
      n++;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
      const neighbors = [1, -1, width, -width];
      for (const d of neighbors) {
        if (d === 1 && x + 1 >= width) continue;
        if (d === -1 && x === 0) continue;
        const np = p + d;
        if (np < 0 || np >= width * height || seen[np]) continue;
        const ni = np * 4;
        if (!isNearBlack(data[ni]!, data[ni + 1]!, data[ni + 2]!)) continue;
        seen[np] = 1;
        stack.push(np);
      }
    }
    const bw = x1 - x0 + 1;
    const bh = y1 - y0 + 1;
    const touches = x0 <= 2 || y0 <= 2 || x1 >= width - 3 || y1 >= height - 3;
    // Short leftover modules of a code are only a few pixels tall.
    if (!touches || n < 64 || bw < 10 || bh < 4) continue;
    if (bw * bh > width * height * 0.15) continue;
    const mark = regionStats(frame, x0, y0, x1 + 1, y1 + 1);
    if (!isEdgeCode(mark)) continue;
    blankPaperAndBlack(frame, x0 - 6, y0 - 6, x1 + 7, y1 + 7);
    blanked = true;
  }
  return blanked;
}

function inkBounds(frame: Frame): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = frame.width;
  let y0 = frame.height;
  let x1 = 0;
  let y1 = 0;
  for (let y = 0; y < frame.height; y++) {
    for (let x = 0; x < frame.width; x++) {
      const i = (y * frame.width + x) * 4;
      if (!isInk(frame.data[i]!, frame.data[i + 1]!, frame.data[i + 2]!)) continue;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x + 1 > x1) x1 = x + 1;
      if (y + 1 > y1) y1 = y + 1;
    }
  }
  if (x1 <= x0 || y1 <= y0) return null;
  return { x0, y0, x1, y1 };
}

/**
 * Drops QR codes and barcodes glued to the edge, then recrops to the ink. Null when the crop is
 * empty or only a speck. The box is relative to the input image.
 */
export async function prepareRasterCrop(buffer: Buffer): Promise<PreparedCrop | null> {
  const img = await loadImage(buffer);
  const width = img.width;
  const height = img.height;
  if (width < 8 || height < 8) return null;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0);
  const frame: Frame = { data: ctx.getImageData(0, 0, width, height).data, width, height };
  const blanked = blankEdgeMarks(frame);
  if (blanked) {
    const imageData = ctx.createImageData(width, height);
    imageData.data.set(frame.data);
    ctx.putImageData(imageData, 0, 0);
  }
  const bounds = inkBounds(frame);
  if (!bounds) return null;
  const x0 = Math.max(0, bounds.x0 - PAD_PX);
  const y0 = Math.max(0, bounds.y0 - PAD_PX);
  const x1 = Math.min(width, bounds.x1 + PAD_PX);
  const y1 = Math.min(height, bounds.y1 + PAD_PX);
  const bw = x1 - x0;
  const bh = y1 - y0;
  if (bw < MIN_INK_PX || bh < MIN_INK_PX) return null;
  const tight =
    !blanked && x0 <= MARGIN_PX && y0 <= MARGIN_PX && width - x1 <= MARGIN_PX && height - y1 <= MARGIN_PX;
  if (tight) return { buffer, box: { x: 0, y: 0, w: 1, h: 1 } };
  const out = createCanvas(bw, bh);
  out.getContext("2d").drawImage(canvas, x0, y0, bw, bh, 0, 0, bw, bh);
  return {
    buffer: out.toBuffer("image/png"),
    box: { x: x0 / width, y: y0 / height, w: bw / width, h: bh / height },
  };
}
