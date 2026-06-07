import { createCanvas, loadImage } from "@napi-rs/canvas";
import type { PixelRect } from "@/lib/pdf-ingest/bbox-math";

const MIN_CROP_BYTES = 1_500;

/**
 * Crop a pixel rectangle from a rendered page PNG (structural / vector regions).
 */
export async function cropPngToPixelRect(
  pagePng: Buffer,
  rect: PixelRect
): Promise<Buffer | null> {
  if (!pagePng || pagePng.length < 1_000) return null;
  if (rect.w < 8 || rect.h < 8) return null;

  try {
    const image = await loadImage(pagePng);
    const w = image.width;
    const h = image.height;
    const x = Math.max(0, Math.min(w - 1, rect.x));
    const y = Math.max(0, Math.min(h - 1, rect.y));
    const cw = Math.max(1, Math.min(w - x, rect.w));
    const ch = Math.max(1, Math.min(h - y, rect.h));

    const canvas = createCanvas(cw, ch);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(image, x, y, cw, ch, 0, 0, cw, ch);

    const out = canvas.toBuffer("image/png");
    return out.length >= MIN_CROP_BYTES ? out : null;
  } catch (e) {
    console.warn("[cropPngToPixelRect]", e);
    return null;
  }
}
