/** PDF transform matrix [a, b, c, d, e, f]. */
export type Matrix6 = [number, number, number, number, number, number];

export type UserRect = { x0: number; y0: number; x1: number; y1: number };

/** Pixel rect on rendered page PNG (top-left origin). */
export type PixelRect = { x: number; y: number; w: number; h: number };

export const IDENTITY_MATRIX: Matrix6 = [1, 0, 0, 1, 0, 0];

export function multiplyMatrix(a: Matrix6, b: Matrix6): Matrix6 {
  const [a1, b1, c1, d1, e1, f1] = a;
  const [a2, b2, c2, d2, e2, f2] = b;
  return [
    a1 * a2 + b1 * c2,
    a1 * b2 + b1 * d2,
    c1 * a2 + d1 * c2,
    c1 * b2 + d1 * d2,
    e1 * a2 + f1 * c2 + e2,
    e1 * b2 + f1 * d2 + f2,
  ];
}

export function transformPoint(m: Matrix6, x: number, y: number): { x: number; y: number } {
  return {
    x: m[0] * x + m[2] * y + m[4],
    y: m[1] * x + m[3] * y + m[5],
  };
}

export function unionUserRects(a: UserRect, b: UserRect): UserRect {
  return {
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
  };
}

export function userRectFromPoints(pts: { x: number; y: number }[]): UserRect | null {
  if (pts.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  if (!Number.isFinite(x0) || x1 - x0 < 0.5 || y1 - y0 < 0.5) return null;
  return { x0, y0, x1, y1 };
}

export function userRectArea(r: UserRect): number {
  return Math.max(0, r.x1 - r.x0) * Math.max(0, r.y1 - r.y0);
}

export function parseMinMaxBBox(raw: unknown): UserRect | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const x0 = Number(o[0] ?? o.x0);
  const y0 = Number(o[1] ?? o.y0);
  const x1 = Number(o[2] ?? o.x1);
  const y1 = Number(o[3] ?? o.y1);
  if (![x0, y0, x1, y1].every(Number.isFinite)) return null;
  const loX = Math.min(x0, x1);
  const hiX = Math.max(x0, x1);
  const loY = Math.min(y0, y1);
  const hiY = Math.max(y0, y1);
  if (hiX - loX < 0.5 || hiY - loY < 0.5) return null;
  return { x0: loX, y0: loY, x1: hiX, y1: hiY };
}

export type ViewportLike = {
  width: number;
  height: number;
  convertToViewportPoint: (x: number, y: number) => number[];
};

export function userRectToPixel(rect: UserRect, viewport: ViewportLike): PixelRect {
  const p0 = viewport.convertToViewportPoint(rect.x0, rect.y0);
  const p1 = viewport.convertToViewportPoint(rect.x1, rect.y1);
  const vx0 = p0[0] ?? 0;
  const vy0 = p0[1] ?? 0;
  const vx1 = p1[0] ?? 0;
  const vy1 = p1[1] ?? 0;
  const x = Math.min(vx0, vx1);
  const y = Math.min(vy0, vy1);
  const w = Math.abs(vx1 - vx0);
  const h = Math.abs(vy1 - vy0);
  return {
    x: Math.max(0, Math.floor(x)),
    y: Math.max(0, Math.floor(y)),
    w: Math.max(1, Math.ceil(w)),
    h: Math.max(1, Math.ceil(h)),
  };
}

export function pixelRectArea(r: PixelRect): number {
  return r.w * r.h;
}

export function iouPixel(a: PixelRect, b: PixelRect): number {
  const ax2 = a.x + a.w;
  const ay2 = a.y + a.h;
  const bx2 = b.x + b.w;
  const by2 = b.y + b.h;
  const ix0 = Math.max(a.x, b.x);
  const iy0 = Math.max(a.y, b.y);
  const ix1 = Math.min(ax2, bx2);
  const iy1 = Math.min(ay2, by2);
  const iw = Math.max(0, ix1 - ix0);
  const ih = Math.max(0, iy1 - iy0);
  const inter = iw * ih;
  const union = pixelRectArea(a) + pixelRectArea(b) - inter;
  return union > 0 ? inter / union : 0;
}

export function expandPixelRect(
  rect: PixelRect,
  padding: number,
  maxW: number,
  maxH: number
): PixelRect {
  const x = Math.max(0, rect.x - padding);
  const y = Math.max(0, rect.y - padding);
  const x2 = Math.min(maxW, rect.x + rect.w + padding);
  const y2 = Math.min(maxH, rect.y + rect.h + padding);
  return { x, y, w: Math.max(1, x2 - x), h: Math.max(1, y2 - y) };
}
