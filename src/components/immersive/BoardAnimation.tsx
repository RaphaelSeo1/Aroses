"use client";

import { useEffect, useState, type ReactNode } from "react";
import { captionLine } from "@/lib/mentored/board-illustration";
import { boardSvgDocument } from "@/lib/mentored/board-svg";

type Props = {
  title: string;
  brief: string;
  labels: string[];
  motion?: string;
  script: string;
  spoken?: string;
  kicker?: string;
  fallback?: ReactNode;
};

/**
 * A Claude-written motion graphic for the concept being taught.
 * The browser plays the animation. The caption is the line Rose is saying.
 */
export function BoardAnimation({
  title,
  brief,
  labels,
  motion,
  script,
  spoken = "",
  kicker = "Whiteboard",
  fallback = null,
}: Props) {
  const labelKey = labels.join("\u0001");
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setSvg(null);
    setFailed(false);
    void fetch("/api/mentored/board-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, brief, labels, motion }),
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("draw failed");
        return (await response.json()) as { svg?: string };
      })
      .then((payload) => {
        if (payload.svg) setSvg(payload.svg);
        else setFailed(true);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setFailed(true);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brief, title, labelKey, motion]);

  if (failed && fallback) return <>{fallback}</>;

  const caption = captionLine(spoken, script);

  return (
    <div className="mx-auto w-full max-w-3xl" data-board-animation={kicker}>
      <div className="relative aspect-video overflow-hidden rounded-2xl bg-[#140c10] shadow-sm ring-1 ring-white/20">
        {svg ? (
          <iframe
            title={title}
            sandbox=""
            srcDoc={boardSvgDocument(svg)}
            className="pointer-events-none h-full w-full border-0"
          />
        ) : (
          <div className="flex h-full items-center justify-center px-8 text-center">
            <p className="text-sm font-medium text-rose-100/80">
              {failed ? "The diagram couldn’t be drawn." : "Drawing the board…"}
            </p>
          </div>
        )}
        <p className="pointer-events-none absolute left-4 top-3 text-[10px] font-semibold uppercase tracking-[0.22em] text-rose-100/70">
          {kicker}
        </p>
      </div>
      {caption ? (
        <p className="mt-3 rounded-2xl bg-[#1c1216] px-4 py-3 text-sm leading-relaxed text-rose-50 ring-1 ring-white/10">
          <span className="mr-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-rose-300">
            Rose
          </span>
          {caption}
        </p>
      ) : null}
    </div>
  );
}
