/** Variance of an ink projection — higher when content bands along that axis. */
export function projectionVariance(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean <= 0) return 0;
  let v = 0;
  for (const x of values) {
    const d = x - mean;
    v += d * d;
  }
  return v / values.length;
}

export function inkProjections(
  data: Uint8ClampedArray,
  width: number,
  height: number
): { rowInk: number[]; colInk: number[] } {
  const rowInk = new Array<number>(height).fill(0);
  const colInk = new Array<number>(width).fill(0);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      if (r > 238 && g > 238 && b > 238) continue;
      rowInk[y]! += 1;
      colInk[x]! += 1;
    }
  }
  return { rowInk, colInk };
}

/** Higher when text/diagram bands run horizontally (upright). */
export function uprightScore(rowInk: number[], colInk: number[]): number {
  const rowVar = projectionVariance(rowInk);
  const colVar = projectionVariance(colInk);
  return rowVar / (rowVar + colVar + 1e-6);
}

export type FigureRotation = 0 | 90 | -90;

/**
 * Pick rotation that maximizes horizontal ink banding. Upright slides score
 * higher at 0°; sideways (CCW) crops score higher at +90° CW correction.
 */
export function rotationCorrectionDegrees(input: {
  rowInk: number[];
  colInk: number[];
  width: number;
  height: number;
}): FigureRotation {
  const { rowInk, colInk, width, height } = input;
  const score0 = uprightScore(rowInk, colInk);

  const rowCw = [...colInk].reverse();
  const colCw = [...rowInk];
  const scoreCw = uprightScore(rowCw, colCw);

  const rowCcw = [...colInk];
  const colCcw = [...rowInk];
  const scoreCcw = uprightScore(rowCcw, colCcw);

  const best = Math.max(score0, scoreCw, scoreCcw);
  const margin = 1.05;

  if (best === scoreCw && scoreCw >= score0 * margin && scoreCw >= scoreCcw) {
    return 90;
  }
  if (best === scoreCcw && scoreCcw >= score0 * margin && scoreCcw > scoreCw) {
    return -90;
  }
  if (best === score0) return 0;

  const aspect = height / Math.max(1, width);
  if (aspect > 1.1 && scoreCw >= scoreCcw) return 90;
  if (aspect < 0.9 && scoreCcw > scoreCw) return -90;
  if (aspect > 1.1) return 90;

  return 0;
}

/** When canvas pixel reads fail (CORS), use aspect ratio only. */
export function rotationFromAspect(width: number, height: number): FigureRotation {
  if (width < 16 || height < 16) return 0;
  const aspect = height / width;
  if (aspect > 1.06) return 90;
  if (aspect < 0.94) return 0;
  return 0;
}

