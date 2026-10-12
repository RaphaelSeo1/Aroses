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
    <div
      className="flex h-full min-h-[clamp(22rem,52vh,36rem)] w-full flex-col"
      data-board-animation={kicker}
    >
      <div className="relative min-h-0 w-full flex-1">
        {svg ? (
          <iframe
            title={title}
            sandbox=""
            srcDoc={boardSvgDocument(svg)}
            className="pointer-events-none absolute inset-0 h-full w-full border-0 bg-[#140c10]"
          />
        ) : (
          <div className="flex h-full items-center justify-center px-8 text-center">
            <p className="text-sm font-medium text-rose-100/80">
              {failed ? "The diagram couldn’t be drawn." : "Drawing the board…"}
            </p>
          </div>
        )}
      </div>
      {caption ? (
        <p className="shrink-0 border-t border-white/10 px-6 py-3 text-sm leading-relaxed text-rose-50 sm:px-8">
          <span className="mr-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-rose-300">
            Rose
          </span>
          {caption}
        </p>
      ) : null}
    </div>
  );
}
