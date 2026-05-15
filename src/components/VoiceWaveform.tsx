"use client";

import { useEffect, useRef } from "react";

type Phase = "off" | "listening" | "recording" | "thinking" | "speaking";

type Props = {
  /** Live mic stream. Tapped when the user is recording / listening. */
  streamRef: React.MutableRefObject<MediaStream | null>;
  /** AI playback audio element. Tapped when phase === "speaking". */
  audioElementRef: React.MutableRefObject<HTMLAudioElement | null>;
  /** Drives source selection + the resting state. */
  phase: Phase;
  /** Pixel height of the canvas. Default 56 (taller = more dramatic). */
  height?: number;
  /** Hex color stops for the gradient (left → right). The wave fades to
   *  each in turn so the line feels alive. */
  colors?: [string, string, string];
};

/**
 * Flowing audio waveform. Draws several offset, semi-transparent
 * sinusoidal lines whose amplitudes are driven by an AnalyserNode's
 * frequency data. The result is a smooth, neon-glow ribbon (not
 * boxy EQ-style bars).
 *
 * Sources:
 *   • Mic MediaStream when the user is talking (phase recording /
 *     listening / thinking).
 *   • <audio> element when the assistant is talking (phase speaking).
 *   • A gentle sine ripple when idle.
 *
 * Connection is retried every animation frame, so the visualizer
 * "catches up" as soon as the mic stream becomes available even if it
 * wasn't ready when the phase first flipped to recording.
 */
export function VoiceWaveform({
  streamRef,
  audioElementRef,
  phase,
  height = 56,
  colors = ["#a855f7", "#ec4899", "#3b82f6"], // violet / pink / blue
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamSourceForRef = useRef<MediaStream | null>(null);
  const elementSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const elementSourceForRef = useRef<HTMLAudioElement | null>(null);
  const dataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const rafRef = useRef<number | null>(null);
  const phaseRef = useRef<Phase>(phase);
  phaseRef.current = phase;

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
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.78;
      analyserRef.current = analyser;
      dataRef.current = new Uint8Array(
        new ArrayBuffer(analyser.frequencyBinCount)
      );
      return ctx;
    } catch {
      return null;
    }
  };

  /** Connect/disconnect sources based on current phase + ref values.
   *  Called from the animation loop so we re-evaluate every frame —
   *  this handles the race where `phase` flips before `streamRef.current`
   *  is populated by the parent. */
  const syncSources = (): void => {
    const ctx = ensureCtx();
    const analyser = analyserRef.current;
    if (!ctx || !analyser) return;

    const p = phaseRef.current;
    const wantsMic =
      p === "recording" || p === "listening" || p === "thinking";
    const wantsAssistant = p === "speaking";

    // Mic source — rebuild if the underlying stream changed (or detach
    // if we don't want mic anymore).
    if (wantsMic) {
      const s = streamRef.current;
      if (s && streamSourceForRef.current !== s) {
        try {
          streamSourceRef.current?.disconnect();
        } catch {
          /* ignore */
        }
        try {
          const src = ctx.createMediaStreamSource(s);
          src.connect(analyser);
          streamSourceRef.current = src;
          streamSourceForRef.current = s;
        } catch {
          streamSourceRef.current = null;
          streamSourceForRef.current = null;
        }
      }
    } else if (streamSourceRef.current) {
      try {
        streamSourceRef.current.disconnect();
      } catch {
        /* ignore */
      }
      streamSourceRef.current = null;
      streamSourceForRef.current = null;
    }

    // Assistant source — createMediaElementSource can only be called
    // ONCE per element so we cache + reuse. Disconnect when we no
    // longer want it but DON'T discard the source (no way to recreate).
    if (wantsAssistant) {
      const el = audioElementRef.current;
      if (el && elementSourceForRef.current !== el) {
        try {
          elementSourceRef.current?.disconnect();
        } catch {
          /* ignore */
        }
        try {
          const src = ctx.createMediaElementSource(el);
          src.connect(analyser);
          // Still route audio to speakers so the user hears it.
          src.connect(ctx.destination);
          elementSourceRef.current = src;
          elementSourceForRef.current = el;
        } catch {
          /* element already tapped — ignore */
        }
      } else if (el && elementSourceRef.current) {
        // Ensure existing source is connected.
        try {
          elementSourceRef.current.connect(analyser);
        } catch {
          /* already connected — ignore */
        }
      }
    } else if (elementSourceRef.current && elementSourceForRef.current) {
      try {
        elementSourceRef.current.disconnect(analyser);
      } catch {
        /* ignore */
      }
    }

    if (ctx.state === "suspended") {
      void ctx.resume().catch(() => undefined);
    }
  };

  // Animation loop.
  useEffect(() => {
    let cancelled = false;

    const draw = () => {
      if (cancelled) return;
      const canvas = canvasRef.current;
      const analyser = analyserRef.current;
      const data = dataRef.current;
      syncSources();
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

      const p = phaseRef.current;
      const hasLiveSource =
        (streamSourceRef.current !== null &&
          (p === "recording" || p === "listening" || p === "thinking")) ||
        (elementSourceRef.current !== null && p === "speaking");

      // Compute amplitude: from analyser when live, gentle sine when idle.
      let amp: number;
      const t = performance.now() / 1000;
      if (hasLiveSource) {
        analyser.getByteFrequencyData(data);
        // Average low + mid-frequency bins for a "voice energy" reading.
        const cutoff = Math.min(data.length, 48);
        let sum = 0;
        for (let i = 0; i < cutoff; i++) sum += data[i];
        amp = (sum / cutoff / 255) * 1.6; // boost slightly
        amp = Math.min(1, Math.max(0.04, amp));
      } else {
        // Idle ripple — barely visible breathing motion.
        amp = 0.06 + Math.sin(t * 1.5) * 0.015;
      }

      // Draw 4 overlapping wave lines with different phase/frequency/colors
      // to get the neon-glow ribbon effect. Each line uses a left→right
      // gradient stop pulled from the `colors` prop.
      const midY = cssH / 2;
      const segments = 64;
      const layers = [
        { freq: 1.6, phase: 0.0, ampMul: 1.0, width: 2.2, alpha: 0.9 },
        { freq: 2.3, phase: 1.4, ampMul: 0.75, width: 1.6, alpha: 0.65 },
        { freq: 3.1, phase: 2.7, ampMul: 0.55, width: 1.2, alpha: 0.45 },
        { freq: 4.4, phase: 4.1, ampMul: 0.4, width: 0.9, alpha: 0.3 },
      ];

      // Pre-build gradient once per frame.
      const grad = c.createLinearGradient(0, 0, cssW, 0);
      grad.addColorStop(0, colors[0]);
      grad.addColorStop(0.5, colors[1]);
      grad.addColorStop(1, colors[2]);

      c.lineCap = "round";
      c.lineJoin = "round";

      for (const layer of layers) {
        c.beginPath();
        for (let i = 0; i <= segments; i++) {
          const x = (i / segments) * cssW;
          // Envelope — softer amplitude at the ends, biggest in the middle.
          const env = Math.sin((i / segments) * Math.PI);
          const wave =
            Math.sin(t * layer.freq + (i / segments) * Math.PI * 4 + layer.phase) *
            amp *
            layer.ampMul *
            env *
            (cssH * 0.45);
          const y = midY + wave;
          if (i === 0) c.moveTo(x, y);
          else c.lineTo(x, y);
        }
        c.globalAlpha = layer.alpha;
        c.strokeStyle = grad;
        c.lineWidth = layer.width;
        c.shadowColor = colors[1];
        c.shadowBlur = 8;
        c.stroke();
      }
      c.shadowBlur = 0;
      c.globalAlpha = 1;

      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);
    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      streamSourceForRef.current = null;
      elementSourceRef.current = null;
      elementSourceForRef.current = null;
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ height, width: "100%" }}
      className="block"
      aria-hidden
    />
  );
}
