"use client";

import { useEffect, useRef } from "react";

type Phase = "off" | "listening" | "recording" | "thinking" | "speaking";

type Props = {
  /** Live mic stream. The visualizer taps into this when the user is
   *  recording / listening, so bars react to the user's voice. */
  streamRef: React.MutableRefObject<MediaStream | null>;
  /** AI playback audio element. Used when phase === "speaking" so bars
   *  react to the assistant's voice instead of the mic. */
  audioElementRef: React.MutableRefObject<HTMLAudioElement | null>;
  /** Drives source selection + the resting state. */
  phase: Phase;
  /** Number of bars. Fewer = chunkier, more = smoother. Default 24. */
  bars?: number;
  /** Pixel height of the canvas. Default 36. */
  height?: number;
  /** Tailwind text-color class — bars are drawn in this color. */
  colorClass?: string;
};

/**
 * Animated audio waveform. Renders a row of bars to a canvas using a
 * Web Audio `AnalyserNode`:
 *
 *   • When the user is speaking (phase = recording/listening) we tap the
 *     mic MediaStream.
 *   • When the assistant is speaking (phase = speaking) we tap the
 *     <audio> element via createMediaElementSource.
 *   • Otherwise we draw a calm idle line.
 *
 * The component owns its own AudioContext + analyser so it does not
 * interfere with the VAD analyser already in the dock — we just read
 * the same MediaStream from a second source node.
 */
export function VoiceWaveform({
  streamRef,
  audioElementRef,
  phase,
  bars = 24,
  height = 36,
  colorClass = "text-rose-500",
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const elementSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const elementSourceForRef = useRef<HTMLAudioElement | null>(null);
  const dataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const rafRef = useRef<number | null>(null);
  const smoothedRef = useRef<number[]>([]);

  // Lazy-init the AudioContext on the first phase change that needs it.
  // Browsers require this to follow a user gesture; by the time the user
  // toggles live mode or taps the mic they've already gestured.
  const ensureCtx = (): AudioContext | null => {
    if (ctxRef.current) return ctxRef.current;
    const AC: typeof AudioContext | undefined =
      typeof window === "undefined"
        ? undefined
        : window.AudioContext ??
          (window as unknown as {
            webkitAudioContext?: typeof AudioContext;
          }).webkitAudioContext;
    if (!AC) return null;
    try {
      const ctx = new AC();
      ctxRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.7;
      analyserRef.current = analyser;
      dataRef.current = new Uint8Array(
        new ArrayBuffer(analyser.frequencyBinCount)
      );
      return ctx;
    } catch {
      return null;
    }
  };

  // Connect the right source for the current phase.
  useEffect(() => {
    const ctx = ensureCtx();
    if (!ctx || !analyserRef.current) return;

    // Disconnect previous mic source (we always rebuild it because the
    // dock can release + reacquire the stream between phases).
    try {
      streamSourceRef.current?.disconnect();
    } catch {
      /* ignore */
    }
    streamSourceRef.current = null;

    const wantsMic =
      phase === "recording" ||
      phase === "listening" ||
      phase === "thinking";
    const wantsAssistant = phase === "speaking";

    if (wantsMic && streamRef.current) {
      try {
        const src = ctx.createMediaStreamSource(streamRef.current);
        src.connect(analyserRef.current);
        streamSourceRef.current = src;
      } catch {
        /* swallow — mic might not be active yet */
      }
    }

    if (wantsAssistant && audioElementRef.current) {
      // createMediaElementSource can only be called ONCE per element.
      // Cache the source + reuse it on subsequent speaking phases.
      const el = audioElementRef.current;
      try {
        if (elementSourceForRef.current !== el) {
          // New audio element — discard the old source.
          try {
            elementSourceRef.current?.disconnect();
          } catch {
            /* ignore */
          }
          const src = ctx.createMediaElementSource(el);
          // Pipe both to the analyser AND to the destination so the user
          // still hears the audio. (Otherwise it goes silent.)
          src.connect(analyserRef.current);
          src.connect(ctx.destination);
          elementSourceRef.current = src;
          elementSourceForRef.current = el;
        }
      } catch {
        /* element might already be tapped — ignore */
      }
    }

    if (ctx.state === "suspended") {
      void ctx.resume().catch(() => undefined);
    }
  }, [phase, streamRef, audioElementRef]);

  // Animation loop.
  useEffect(() => {
    let cancelled = false;
    smoothedRef.current = new Array(bars).fill(0);

    const draw = () => {
      if (cancelled) return;
      const canvas = canvasRef.current;
      const analyser = analyserRef.current;
      const data = dataRef.current;
      if (!canvas || !analyser || !data) {
        rafRef.current = requestAnimationFrame(draw);
        return;
      }

      const c = canvas.getContext("2d");
      if (!c) return;

      const cssW = canvas.clientWidth;
      const cssH = canvas.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== cssW * dpr || canvas.height !== cssH * dpr) {
        canvas.width = Math.max(1, Math.floor(cssW * dpr));
        canvas.height = Math.max(1, Math.floor(cssH * dpr));
      }
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, cssW, cssH);

      const idle =
        phase === "off" || (phase === "listening" && !streamSourceRef.current);

      let buckets: number[];
      if (idle) {
        // Calm sine-y resting line so the strip doesn't look dead.
        const t = performance.now() / 600;
        buckets = new Array(bars).fill(0).map((_, i) => {
          const v = (Math.sin(t + i * 0.4) + 1) / 2;
          return v * 0.18; // 0..0.18 — small ripple
        });
      } else {
        analyser.getByteFrequencyData(data);
        // Bucket the frequency bins down to `bars` values.
        const binsPerBar = Math.max(1, Math.floor(data.length / bars));
        buckets = new Array(bars).fill(0).map((_, i) => {
          let sum = 0;
          let count = 0;
          for (let j = 0; j < binsPerBar; j++) {
            const idx = i * binsPerBar + j;
            if (idx < data.length) {
              sum += data[idx];
              count++;
            }
          }
          return count > 0 ? sum / count / 255 : 0;
        });
      }

      // Smoothing — interpolate towards the latest value so bars don't
      // flicker on every animation frame.
      const smoothed = smoothedRef.current;
      const alpha = idle ? 0.2 : 0.35;
      for (let i = 0; i < bars; i++) {
        smoothed[i] = smoothed[i] + (buckets[i] - smoothed[i]) * alpha;
      }

      // Resolve the color from the inherited text color of the canvas.
      const color =
        getComputedStyle(canvas).color || "rgb(244, 63, 94)" /* rose-500 */;
      c.fillStyle = color;

      const gap = 3;
      const barWidth = Math.max(2, (cssW - gap * (bars - 1)) / bars);
      const midY = cssH / 2;
      for (let i = 0; i < bars; i++) {
        const amp = Math.min(1, Math.max(0.02, smoothed[i]));
        const h = Math.max(2, amp * cssH);
        const x = i * (barWidth + gap);
        const y = midY - h / 2;
        // Rounded bars — fall back to plain rect if not supported.
        const r = Math.min(barWidth / 2, 3);
        if (typeof c.roundRect === "function") {
          c.beginPath();
          c.roundRect(x, y, barWidth, h, r);
          c.fill();
        } else {
          c.fillRect(x, y, barWidth, h);
        }
      }

      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);
    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [bars, phase]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      try {
        streamSourceRef.current?.disconnect();
      } catch {
        /* ignore */
      }
      try {
        elementSourceRef.current?.disconnect();
      } catch {
        /* ignore */
      }
      try {
        ctxRef.current?.close();
      } catch {
        /* ignore */
      }
      ctxRef.current = null;
      analyserRef.current = null;
      streamSourceRef.current = null;
      elementSourceRef.current = null;
      elementSourceForRef.current = null;
    };
  }, []);

  // Tailwind text color drives the bar fill via getComputedStyle.
  return (
    <canvas
      ref={canvasRef}
      style={{ height, width: "100%" }}
      className={`block ${colorClass}`}
      aria-hidden
    />
  );
}
