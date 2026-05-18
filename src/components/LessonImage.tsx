"use client";

import { useEffect, useState } from "react";

/**
 * Licensed lesson image (Wikimedia Commons) rendered inline above
 * lesson content. Lazily fetches its own data on mount via
 * `/api/study-materials/[materialId]/modules/[moduleId]/lessons/[lessonIndex]/image`
 * — the API does first-time classification + Wikimedia search +
 * cache-write, so subsequent renders return instantly.
 *
 * UX:
 *   - Shimmering skeleton while loading (~300-1500ms classifier
 *     + search on first render, instant on cache hit).
 *   - Renders nothing if the classifier said `needsImage: false`
 *     or Wikimedia had no usable match. Per spec, NEVER a broken
 *     placeholder.
 *   - Attribution required by Wikimedia Commons licensing renders
 *     in a small caption beneath, linking to the source page.
 *   - Click-to-expand opens a lightbox modal at full resolution.
 */

type LessonImagePayload = {
  url: string;
  thumbUrl: string;
  sourceUrl: string;
  attribution: string;
  type: "diagram" | "photo" | "illustration";
};

export function LessonImage({
  materialId,
  moduleId,
  lessonIndex,
  className,
}: {
  materialId: string;
  moduleId: number;
  lessonIndex: number;
  className?: string;
}) {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "hidden" }
    | { status: "ready"; image: LessonImagePayload }
  >({ status: "loading" });
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Async fetch — the setState calls inside this IIFE are async
    // by definition (they happen AFTER an await), which is fine
    // per react-hooks/set-state-in-effect. The initial "loading"
    // state is set via useState's initial value above.
    void (async () => {
      try {
        const res = await fetch(
          `/api/study-materials/${materialId}/modules/${moduleId}/lessons/${lessonIndex}/image`,
          { method: "GET" }
        );
        if (cancelled) return;
        if (!res.ok) {
          setState({ status: "hidden" });
          return;
        }
        const body = (await res.json()) as {
          image: LessonImagePayload | null;
        };
        if (cancelled) return;
        if (!body.image) {
          setState({ status: "hidden" });
          return;
        }
        setState({ status: "ready", image: body.image });
      } catch {
        if (!cancelled) setState({ status: "hidden" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [materialId, moduleId, lessonIndex]);

  if (state.status === "hidden") return null;

  if (state.status === "loading") {
    return (
      <div
        className={`relative overflow-hidden rounded-2xl bg-gradient-to-br from-zinc-100 to-zinc-50 dark:from-zinc-800 dark:to-zinc-900 ${className ?? ""}`}
        style={{ aspectRatio: "16 / 9" }}
        aria-busy="true"
        aria-label="Loading image"
      >
        <div className="absolute inset-0 animate-pulse bg-zinc-200/40 dark:bg-zinc-700/40" />
      </div>
    );
  }

  const { image } = state;
  return (
    <figure
      className={`overflow-hidden rounded-2xl border border-zinc-200/70 bg-zinc-50/40 dark:border-zinc-700/60 dark:bg-zinc-900/40 ${className ?? ""}`}
    >
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="block w-full"
        aria-label="Expand image"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={image.thumbUrl}
          alt=""
          className="block h-auto w-full object-cover"
          loading="lazy"
        />
      </button>
      <figcaption className="flex items-center justify-between gap-2 px-3 py-2 text-[11px] text-zinc-500 dark:text-zinc-400">
        <span className="truncate">{image.attribution}</span>
        {image.sourceUrl ? (
          <a
            href={image.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 underline-offset-2 hover:underline"
          >
            Source
          </a>
        ) : null}
      </figcaption>

      {expanded ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={() => setExpanded(false)}
          role="dialog"
          aria-modal="true"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image.url}
            alt=""
            className="max-h-[90vh] max-w-[95vw] rounded-lg object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="absolute right-4 top-4 rounded-full bg-white/90 px-3 py-1 text-sm font-medium text-zinc-800 shadow hover:bg-white"
            aria-label="Close"
          >
            Close
          </button>
        </div>
      ) : null}
    </figure>
  );
}
