import { createCanvas, loadImage } from "@napi-rs/canvas";

/** Vision bbox on 0–1000 scale: [ymin, xmin, ymax, xmax], origin top-left. */
export type NormalizedFigureBbox = {
  ymin: number;
  xmin: number;
  ymax: number;
  xmax: number;
};

const MIN_CROP_PX = 48;

function cropPaddingUnits(): { pad: number; extraBottom: number } {
  const raw = process.env.PDF_INGEST_CROP_PADDING?.trim();
  const n = raw ? Number.parseInt(raw, 10) : Number.NaN;
  const pad = Number.isFinite(n) && n >= 0 ? Math.min(n, 100) : 42;
  return { pad, extraBottom: Math.min(72, Math.round(pad * 1.5)) };
}

/** Loosen vision bbox so labels/footers below diagrams are not clipped. */
export function expandFigureBbox(
  bbox: NormalizedFigureBbox
): NormalizedFigureBbox {
  const { pad, extraBottom } = cropPaddingUnits();
  const bboxW = bbox.xmax - bbox.xmin;
  const bboxH = bbox.ymax - bbox.ymin;
  const extraX = bboxW > 480 ? Math.min(72, Math.round(bboxW * 0.07)) : 0;
  // Skip slide title bars (☒ font rows) above diagrams.
  const skipTitle = bboxH > 180 ? Math.min(90, Math.round(bboxH * 0.1)) : 0;
  return {
    ymin: Math.max(0, bbox.ymin - Math.max(0, pad - skipTitle) + skipTitle),
    xmin: Math.max(0, bbox.xmin - pad),
    ymax: Math.min(1000, bbox.ymax + pad + extraBottom),
    xmax: Math.min(1000, bbox.xmax + pad + extraX),
  };
}

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
 * No rotation — pixels match the PDF page render.
 */
export async function cropPngToFigure(
  pagePng: Buffer,
  bbox: NormalizedFigureBbox
): Promise<Buffer | null> {
  if (!pagePng || pagePng.length < 1_000) return null;

  try {
    const expanded = expandFigureBbox(bbox);
    const image = await loadImage(pagePng);
    const w = image.width;
    const h = image.height;
    if (w < 10 || h < 10) return null;

    let x = Math.floor((expanded.xmin / 1000) * w);
    let y = Math.floor((expanded.ymin / 1000) * h);
    let cw = Math.ceil(((expanded.xmax - expanded.xmin) / 1000) * w);
    let ch = Math.ceil(((expanded.ymax - expanded.ymin) / 1000) * h);

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

/** Fallback when vision bboxes fail: tight center band only (not full-page whitespace). */
export async function cropPageDiagramFallback(
  pagePng: Buffer
): Promise<Buffer | null> {
  return cropPngToFigure(pagePng, {
    ymin: 200,
    xmin: 60,
    ymax: 820,
    xmax: 940,
  });
}
