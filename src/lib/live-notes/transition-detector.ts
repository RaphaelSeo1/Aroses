"use client";

import type { SampledFrame } from "@/lib/live-notes/frame-sampler";

/**
 * Region-weighted pixel diff to detect slide / content transitions.
 * Ignores most cursor motion, OS chrome, and bottom progress bars.
 */

export type TransitionDetectorOptions = {
  /** Mean absolute delta (0–255) on weighted pixels. Default 12. */
  meanThreshold?: number;
  /** Fraction of pixels that must change by ≥ pixelThreshold. Default 0.08. */
  extentFraction?: number;
  /** Per-pixel change gate for extent. Default 25. */
  pixelThreshold?: number;
  /** Ignore new transitions for this many ms after one fires. Default 4000. */
  minIntervalMs?: number;
};

export type TransitionDecision = {
  isTransition: boolean;
  meanDelta: number;
  extentFraction: number;
};

export class TransitionDetector {
  private prev: SampledFrame | null = null;
  private lastFireAt = 0;
  private meanThreshold: number;
  private extentFraction: number;
  private pixelThreshold: number;
  private minIntervalMs: number;

  constructor(opts?: TransitionDetectorOptions) {
    this.meanThreshold = opts?.meanThreshold ?? 12;
    this.extentFraction = opts?.extentFraction ?? 0.08;
    this.pixelThreshold = opts?.pixelThreshold ?? 25;
    this.minIntervalMs = opts?.minIntervalMs ?? 4_000;
  }

  reset(): void {
    this.prev = null;
    this.lastFireAt = 0;
  }

  /**
   * Compare `frame` to the last accepted baseline. On transition, the frame
   * becomes the new baseline. Non-transitions still update baseline slowly
   * only when mean delta is tiny (drift) — otherwise keep previous slide.
   */
  evaluate(frame: SampledFrame): TransitionDecision {
    if (!this.prev || this.prev.width !== frame.width || this.prev.height !== frame.height) {
      this.prev = frame;
      // First frame: treat as a transition so we get an initial screen read.
      this.lastFireAt = frame.at;
      return { isTransition: true, meanDelta: 255, extentFraction: 1 };
    }

    const { meanDelta, extent } = weightedDiff(this.prev, frame);
    const now = frame.at;
    const cooled = now - this.lastFireAt >= this.minIntervalMs;
    const isTransition =
      cooled &&
      meanDelta >= this.meanThreshold &&
      extent >= this.extentFraction;

    if (isTransition) {
      this.prev = frame;
      this.lastFireAt = now;
    } else if (meanDelta < 3) {
      // Near-identical — refresh baseline so slow fades don't accumulate.
      this.prev = frame;
    }

    return {
      isTransition,
      meanDelta,
      extentFraction: extent,
    };
  }
}

function weightAt(x: number, y: number, w: number, h: number): number {
  const nx = x / w;
  const ny = y / h;
  // Outer 15% border — cursors / chrome
  if (nx < 0.15 || nx > 0.85 || ny < 0.15 || ny > 0.85) return 0.25;
  // Bottom 12% — progress bars / video controls
  if (ny > 0.88) return 0.15;
  return 1;
}

function weightedDiff(
  a: SampledFrame,
  b: SampledFrame
): { meanDelta: number; extent: number } {
  const w = a.width;
  const h = a.height;
  const n = w * h;
  let weightedSum = 0;
  let weightTotal = 0;
  let changed = 0;
  let counted = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const wt = weightAt(x, y, w, h);
      const d = Math.abs(a.gray[i]! - b.gray[i]!);
      weightedSum += d * wt;
      weightTotal += wt;
      counted += 1;
      if (d >= 25) changed += 1;
    }
  }

  return {
    meanDelta: weightTotal > 0 ? weightedSum / weightTotal : 0,
    extent: counted > 0 ? changed / n : 0,
  };
}
