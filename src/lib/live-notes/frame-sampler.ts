"use client";

/**
 * Sample frames from a shared video track onto a canvas.
 * Diff ticks stay cheap (grayscale only); JPEG is encoded only when uploading.
 */

export type SampledFrame = {
  /** Downscaled grayscale luminance buffer for diffing. */
  gray: Uint8Array;
  width: number;
  height: number;
  /** JPEG blob — only present when encodeJpeg / sample() requested it. */
  jpeg?: Blob;
  /** Wall-clock ms when sampled. */
  at: number;
};

/** Diff resolution — lower than upload size to cut getImageData cost. */
const DEFAULT_MAX_WIDTH = 480;
const DEFAULT_JPEG_QUALITY = 0.68;

export class FrameSampler {
  private video: HTMLVideoElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private maxWidth: number;
  private jpegQuality: number;
  private attachedStream: MediaStream | null = null;

  constructor(opts?: { maxWidth?: number; jpegQuality?: number }) {
    this.maxWidth = opts?.maxWidth ?? DEFAULT_MAX_WIDTH;
    this.jpegQuality = opts?.jpegQuality ?? DEFAULT_JPEG_QUALITY;
    this.video = document.createElement("video");
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.setAttribute("playsinline", "true");
    this.canvas = document.createElement("canvas");
    const ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Canvas 2D unavailable");
    this.ctx = ctx;
  }

  attach(stream: MediaStream): void {
    this.attachedStream = stream;
    this.video.srcObject = stream;
    void this.video.play().catch(() => {});
  }

  detach(): void {
    this.attachedStream = null;
    this.video.pause();
    this.video.srcObject = null;
  }

  hasLiveVideo(): boolean {
    const track = this.attachedStream?.getVideoTracks()[0];
    return Boolean(track && track.readyState === "live");
  }

  /** Draw + grayscale only — used every poll tick. */
  sampleGray(): SampledFrame | null {
    if (!this.hasLiveVideo()) return null;
    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;
    if (!vw || !vh) return null;

    const scale = Math.min(1, this.maxWidth / vw);
    const w = Math.max(1, Math.round(vw * scale));
    const h = Math.max(1, Math.round(vh * scale));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.ctx.drawImage(this.video, 0, 0, w, h);
    const imageData = this.ctx.getImageData(0, 0, w, h);
    const gray = new Uint8Array(w * h);
    const data = imageData.data;
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      // Rec. 601 luma
      gray[p] = (data[i]! * 77 + data[i + 1]! * 150 + data[i + 2]! * 29) >> 8;
    }

    return { gray, width: w, height: h, at: Date.now() };
  }

  /** Encode the current canvas as JPEG (call after sampleGray / draw). */
  async encodeJpeg(): Promise<Blob | null> {
    if (!this.canvas.width || !this.canvas.height) return null;
    return new Promise<Blob | null>((resolve) => {
      this.canvas.toBlob((b) => resolve(b), "image/jpeg", this.jpegQuality);
    });
  }

  /** Full sample with JPEG — only for upload path. */
  async sample(): Promise<SampledFrame | null> {
    const gray = this.sampleGray();
    if (!gray) return null;
    const jpeg = await this.encodeJpeg();
    if (!jpeg) return null;
    return { ...gray, jpeg };
  }

  dispose(): void {
    this.detach();
  }
}
