"use client";

import { useEffect, useState, type ReactNode } from "react";
import { revealFraction } from "@/lib/mentored/board-illustration";

type Props = {
  title: string;
  brief: string;
  labels: string[];
  /** The explanation Rose is saying. The picture uncovers as this is spoken. */
  script: string;
  spoken?: string;
  kicker?: string;
  fallback?: ReactNode;
};

/**
 * Illustrated teaching board. The picture is requested once per concept,
 * then uncovered from the left while the explanation is taught.
 */
export function BoardIllustration({
  title,
  brief,
  labels,
  script,
  spoken = "",
  kicker = "Whiteboard",
  fallback = null,
}: Props) {
  const labelKey = labels.join("\u0001");
  const [image, setImage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [shown, setShown] = useState(0.08);

  useEffect(() => {
    if (!image) return;
    const started = performance.now();
    setElapsedMs(0);
    setShown(0.08);
    const id = window.setInterval(() => {
      setElapsedMs(performance.now() - started);
    }, 200);
    return () => window.clearInterval(id);
  }, [image]);

  useEffect(() => {
    const controller = new AbortController();
    setImage(null);
    setFailed(false);
    void fetch("/api/mentored/board-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, brief, labels }),
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("draw failed");
        return (await response.json()) as { image?: string };
      })
      .then((payload) => {
        if (payload.image) setImage(payload.image);
        else setFailed(true);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setFailed(true);
      });
    return () => controller.abort();
    // labels is represented by labelKey so a new array identity does not redraw.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brief, title, labelKey]);

  const target = revealFraction(spoken, script, elapsedMs);

  useEffect(() => {
    const id = window.setInterval(() => {
      setShown((current) => {
        if (Math.abs(target - current) < 0.01) return target;
        return current + (target - current) * 0.22;
      });
    }, 50);
    return () => window.clearInterval(id);
  }, [target]);

  const percent = Math.round(shown * 1000) / 10;

  if (failed && fallback) return <>{fallback}</>;

  return (
    <div
      className="relative mx-auto aspect-square w-full max-w-3xl overflow-hidden rounded-2xl bg-[#140e12] shadow-sm ring-1 ring-white/20"
      data-board-illustration={kicker}
      data-reveal={percent}
    >
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image}
          alt={title}
          className="h-full w-full object-cover"
          style={{ clipPath: `inset(0 ${Math.max(0, 100 - percent)}% 0 0)` }}
        />
      ) : (
        <div className="flex h-full items-center justify-center px-8 text-center">
          <p className="text-sm font-medium text-rose-100/80">
            {failed ? "The diagram couldn’t be drawn." : "Drawing the diagram…"}
          </p>
        </div>
      )}
      {image && percent < 98 ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 w-1 bg-gradient-to-r from-transparent via-rose-200/80 to-transparent"
          style={{ left: `calc(${percent}% - 2px)` }}
        />
      ) : null}
      <p className="pointer-events-none absolute left-4 top-3 text-[10px] font-semibold uppercase tracking-[0.22em] text-rose-100/70">
        {kicker}
      </p>
    </div>
  );
}
