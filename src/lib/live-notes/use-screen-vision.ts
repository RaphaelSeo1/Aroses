"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FrameSampler } from "@/lib/live-notes/frame-sampler";
import { TransitionDetector } from "@/lib/live-notes/transition-detector";

export type ScreenContentSlice = {
  seq: number;
  atMs: number;
  title: string | null;
  flatText: string;
};

const SAMPLE_INTERVAL_MS = 4_000;
const CONFIRM_DELAY_MS = 500;
const MAX_RING = 6;

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("read failed"));
        return;
      }
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(blob);
  });
}

/**
 * Samples the shared video track, detects slide transitions, and POSTs
 * frames to /screen-frame. Keeps a ring of recent extracts for synthesize.
 */
export function useScreenVision(options: {
  sessionId: string;
  stream: MediaStream | null;
  enabled: boolean;
  /** Recording elapsed ms (excludes pause). */
  getElapsedMs: () => number;
  onMirrorDetected?: () => void;
  onError?: (message: string) => void;
}) {
  const {
    sessionId,
    stream,
    enabled,
    getElapsedMs,
    onMirrorDetected,
    onError,
  } = options;

  const [slices, setSlices] = useState<ScreenContentSlice[]>([]);
  const [visionCalls, setVisionCalls] = useState(0);
  const [capped, setCapped] = useState(false);
  const [active, setActive] = useState(false);

  const samplerRef = useRef<FrameSampler | null>(null);
  const detectorRef = useRef<TransitionDetector | null>(null);
  const inFlightRef = useRef(false);
  const cappedRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const confirmTimerRef = useRef<number | null>(null);
  const onMirrorRef = useRef(onMirrorDetected);
  onMirrorRef.current = onMirrorDetected;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const getElapsedRef = useRef(getElapsedMs);
  getElapsedRef.current = getElapsedMs;

  const pushSlice = useCallback((slice: ScreenContentSlice) => {
    setSlices((prev) => [...prev, slice].slice(-MAX_RING));
  }, []);

  const uploadFrame = useCallback(
    async (jpeg: Blob) => {
      if (inFlightRef.current || cappedRef.current) return;
      inFlightRef.current = true;
      try {
        const jpegBase64 = await blobToBase64(jpeg);
        const res = await fetch(`/api/live-notes/${sessionId}/screen-frame`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jpegBase64,
            atMs: getElapsedRef.current(),
            mediaType: "image/jpeg",
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          capped?: boolean;
          calls?: number;
          seq?: number;
          title?: string | null;
          flatText?: string;
          isArosesUi?: boolean;
          error?: string;
        };
        if (typeof data.calls === "number") setVisionCalls(data.calls);
        if (data.capped) {
          cappedRef.current = true;
          setCapped(true);
        }
        if (!res.ok) {
          if (res.status !== 502) {
            onErrorRef.current?.(data.error || "Screen reading failed.");
          }
          return;
        }
        if (data.isArosesUi) {
          onMirrorRef.current?.();
        }
        if (typeof data.seq === "number" && typeof data.flatText === "string") {
          if (data.flatText.trim()) {
            pushSlice({
              seq: data.seq,
              atMs: getElapsedRef.current(),
              title: data.title ?? null,
              flatText: data.flatText,
            });
          }
        }
      } catch {
        /* network — next transition retries */
      } finally {
        inFlightRef.current = false;
      }
    },
    [sessionId, pushSlice]
  );

  useEffect(() => {
    cappedRef.current = false;
    setCapped(false);
    setSlices([]);
    setVisionCalls(0);

    if (!enabled || !stream?.getVideoTracks().some((t) => t.readyState === "live")) {
      setActive(false);
      samplerRef.current?.dispose();
      samplerRef.current = null;
      detectorRef.current = null;
      if (timerRef.current != null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (confirmTimerRef.current != null) {
        window.clearTimeout(confirmTimerRef.current);
        confirmTimerRef.current = null;
      }
      return;
    }

    const sampler = new FrameSampler();
    sampler.attach(stream);
    samplerRef.current = sampler;
    const detector = new TransitionDetector();
    detectorRef.current = detector;
    setActive(true);

    const tick = async () => {
      if (confirmTimerRef.current != null) return; // waiting to confirm
      // Diff-only sample — skip JPEG encode on every poll (big lag win).
      const frame = sampler.sampleGray();
      if (!frame) return;
      const decision = detector.evaluate(frame);
      if (!decision.isTransition) return;

      // Debounce mid-animation: re-sample + JPEG only when uploading.
      confirmTimerRef.current = window.setTimeout(() => {
        confirmTimerRef.current = null;
        void (async () => {
          const stable = await sampler.sample();
          if (stable?.jpeg) void uploadFrame(stable.jpeg);
        })();
      }, CONFIRM_DELAY_MS) as unknown as number;
    };

    void tick();
    timerRef.current = window.setInterval(() => {
      void tick();
    }, SAMPLE_INTERVAL_MS) as unknown as number;

    return () => {
      if (timerRef.current != null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (confirmTimerRef.current != null) {
        window.clearTimeout(confirmTimerRef.current);
        confirmTimerRef.current = null;
      }
      sampler.dispose();
      samplerRef.current = null;
      detectorRef.current = null;
      setActive(false);
    };
  }, [enabled, stream, sessionId, uploadFrame]);

  const screenContextText = slices
    .map((s) => {
      const m = Math.floor(s.atMs / 60_000);
      const sec = Math.floor((s.atMs % 60_000) / 1000);
      const stamp = `${m}:${String(sec).padStart(2, "0")}`;
      return s.title
        ? `[${stamp}] ${s.title}\n${s.flatText}`
        : `[${stamp}]\n${s.flatText}`;
    })
    .join("\n\n")
    .slice(-4_000);

  return {
    slices,
    screenContextText,
    visionCalls,
    capped,
    active,
  };
}
