"use client";

import { memo } from "react";
import { GlassPanel } from "@/components/immersive/GlassPanel";
import type { IngestSourceImageRecord } from "@/lib/study-ingest/source-images/types";

/**
 * Shows a figure pulled directly from the student's uploaded material (a PDF
 * page render, slide, or embedded diagram) while Rose teaches the matching
 * concept. Unlike the Wikimedia image slot, this is grounded in the student's
 * own source, so it's shown proactively on chunk entry.
 */
function SourceFigurePanelImpl({
  figure,
  onDismiss,
}: {
  figure: IngestSourceImageRecord;
  onDismiss?: () => void;
}) {
  const locator =
    figure.anchorType === "page"
      ? `page ${figure.anchorIndex}`
      : figure.anchorType === "slide"
        ? `slide ${figure.anchorIndex}`
        : "your material";

  return (
    <GlassPanel tone="subtle">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
          From your material
        </p>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium text-zinc-500">
            {figure.label || locator}
          </span>
          {onDismiss ? (
            <button
              type="button"
              onClick={onDismiss}
              className="rounded-full border border-zinc-200/80 bg-white/90 px-2 py-0.5 text-[11px] font-medium text-zinc-600 shadow-sm hover:bg-white"
              aria-label="Hide this figure"
            >
              Hide
            </button>
          ) : null}
        </div>
      </div>
      <figure className="mt-2 overflow-hidden rounded-xl">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={figure.url}
          alt={figure.label || `Figure from ${figure.sourceFileName}`}
          className="block max-h-96 w-full object-contain bg-white"
        />
        <figcaption className="mt-2 px-1 text-[11px] text-zinc-500">
          {figure.sourceFileName}
          {figure.anchorType !== "document" ? ` · ${locator}` : ""}
        </figcaption>
      </figure>
    </GlassPanel>
  );
}

export const SourceFigurePanel = memo(SourceFigurePanelImpl);
