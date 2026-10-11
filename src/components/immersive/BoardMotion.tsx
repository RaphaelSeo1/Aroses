"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  motionFrameIndex,
  revealFraction,
} from "@/lib/mentored/board-illustration";

type Props = {
  title: string;
  brief: string;
  labels: string[];
  motion: string;
  script: string;
  spoken?: string;
  kicker?: string;
  /** clip asks for a short video and plays the moving frames if the clip is not ready. */
  form?: "animation" | "clip";
  fallback?: ReactNode;
};

/**
 * A teaching figure that changes while the explanation is spoken.
 * Animation steps through illustrated stages. A clip plays a short video
 * and seeks it to the same moment in the explanation.
 */
export function BoardMotion({
  title,
  brief,
  labels,
  motion,
  script,
  spoken = "",
  kicker = "Whiteboard",
  form = "animation",
  fallback = null,
}: Props) {
  const labelKey = labels.join("\u0001");
  const [frames, setFrames] = useState<string[]>([]);
  const [video, setVideo] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [shown, setShown] = useState(0.08);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const started = performance.now();
    const id = window.setInterval(() => {
      setElapsedMs(performance.now() - started);
    }, 200);
    return () => window.clearInterval(id);
  }, [brief, motion, form]);

  useEffect(() => {
    const controller = new AbortController();
    setFrames([]);
    setVideo(null);
    setFailed(false);
    setShown(0.08);
    void fetch("/api/mentored/board-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, brief, labels, motion, form }),
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("draw failed");
        return (await response.json()) as {
          video?: string;
          frames?: string[];
          image?: string;
        };
      })
      .then((payload) => {
        if (payload.video) setVideo(payload.video);
        else if (payload.frames && payload.frames.length > 0) setFrames(payload.frames);
        else if (payload.image) setFrames([payload.image]);
        else setFailed(true);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setFailed(true);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brief, title, labelKey, motion, form]);

  const ready = Boolean(video) || frames.length > 0;
  const target = revealFraction(spoken, script, ready ? elapsedMs : 0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setShown((current) => {
        if (Math.abs(target - current) < 0.01) return target;
        return current + (target - current) * 0.22;
      });
    }, 50);
    return () => window.clearInterval(id);
  }, [target]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !video || !Number.isFinite(el.duration) || el.duration <= 0) return;
    const next = Math.min(el.duration - 0.05, shown * el.duration);
    if (Math.abs(el.currentTime - next) > 0.2) el.currentTime = next;
  }, [shown, video]);

  const frame = motionFrameIndex(shown, frames.length);

  if (failed && fallback) return <>{fallback}</>;

  return (
    <div
      className="relative mx-auto aspect-square w-full max-w-3xl overflow-hidden rounded-2xl bg-[#140e12] shadow-sm ring-1 ring-white/20"
      data-board-illustration={kicker}
      data-visual-form={video ? "clip" : "animation"}
      data-frame={video ? undefined : frame}
    >
      {video ? (
        <video
          ref={videoRef}
          src={video}
          muted
          playsInline
          autoPlay
          className="h-full w-full object-cover"
          aria-label={title}
        />
      ) : frames.length > 0 ? (
        frames.map((src, index) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={src.slice(0, 48)}
            src={src}
            alt={index === frame ? title : ""}
            className="absolute inset-0 h-full w-full object-cover transition-opacity duration-500"
            style={{ opacity: index === frame ? 1 : 0 }}
          />
        ))
      ) : (
        <div className="flex h-full items-center justify-center px-8 text-center">
          <p className="text-sm font-medium text-rose-100/80">
            {failed ? "The diagram couldn’t be drawn." : "Drawing the motion…"}
          </p>
        </div>
      )}
      <p className="pointer-events-none absolute left-4 top-3 text-[10px] font-semibold uppercase tracking-[0.22em] text-rose-100/70">
        {kicker}
      </p>
    </div>
  );
}
