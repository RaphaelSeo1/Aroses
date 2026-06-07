import { createCanvas, loadImage } from "@napi-rs/canvas";

/** Vision bbox on 0–1000 scale: [ymin, xmin, ymax, xmax], origin top-left. */
export type NormalizedFigureBbox = {
  ymin: number;
  xmin: number;
  ymax: number;
  xmax: number;
};

const MIN_CROP_PX = 48;

export function parseNormalizedBbox(raw: unknown): NormalizedFigureBbox | null {
  if (!Array.isArray(raw) || raw.length < 4) return null;
  const nums = raw.map((v) => Number(v));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  let [ymin, xmin, ymax, xmax] = nums as [number, number, number, number];
  ymin = Math.max(0, Math.min(1000, ymin));
  xmin = Math.max(0, Math.min(1000, xmin));
  ymax = Math.max(0, Math.min(1000, ymax));
  xmax = Math.max(0, Math.min(1000, xmax));
  if (ymax - ymin < 20 || xmax - xmin < 20) return null;
  if (ymin > ymax) [ymin, ymax] = [ymax, ymin];
  if (xmin > xmax) [xmin, xmax] = [xmax, xmin];
  return { ymin, xmin, ymax, xmax };
}

/**
 * Crop a diagram region from a rendered PDF page PNG using vision bbox coords.
 */
export async function cropPngToFigure(
  pagePng: Buffer,
  bbox: NormalizedFigureBbox
): Promise<Buffer | null> {
  if (!pagePng || pagePng.length < 1_000) return null;

  try {
    const image = await loadImage(pagePng);
    const w = image.width;
    const h = image.height;
    if (w < 10 || h < 10) return null;

    let x = Math.floor((bbox.xmin / 1000) * w);
    let y = Math.floor((bbox.ymin / 1000) * h);
    let cw = Math.ceil(((bbox.xmax - bbox.xmin) / 1000) * w);
    let ch = Math.ceil(((bbox.ymax - bbox.ymin) / 1000) * h);

    x = Math.max(0, Math.min(w - 1, x));
    y = Math.max(0, Math.min(h - 1, y));
    cw = Math.max(MIN_CROP_PX, Math.min(w - x, cw));
    ch = Math.max(MIN_CROP_PX, Math.min(h - y, ch));

    const canvas = createCanvas(cw, ch);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(image, x, y, cw, ch, 0, 0, cw, ch);

    const out = canvas.toBuffer("image/png");
    return out.length >= 2_000 ? out : null;
  } catch (e) {
    console.warn("[cropPngToFigure]", e);
    return null;
  }
}
