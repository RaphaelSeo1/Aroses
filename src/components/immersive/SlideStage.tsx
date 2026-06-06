"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { IngestSourceImageRecord } from "@/lib/study-ingest/source-images/types";

/**
 * The whiteboard — a live, auto-advancing presentation surface (à la
 * NotebookLM's generated video) that Rose "draws on" as she teaches.
 *
 * Instead of one static list, it cycles through *scenes* and swaps the
 * visual automatically based on what Rose is currently narrating:
 *
 *   • title  — the concept headline, big and centered.
 *   • point  — one key point at a time, blown up like a slide statement
 *              with a step number, so the board changes as she moves on.
 *   • figure — the actual table / diagram / page pulled from the student's
 *              own upload (or a fallback image they asked for), shown large.
 *
 * In voice mode the active scene follows the live narration (we match the
 * sentence Rose just said to the closest key point, and jump to the figure
 * when she references a visual). In text / silent mode it auto-advances on
 * a gentle timer so the board still feels alive.
 *
 * The whole surface is glassy + translucent over the cloud background.
 */

type Beat =
  | { kind: "title" }
  | { kind: "point"; index: number }
  | { kind: "figure" };

function SlideStageImpl({
  chunkId,
  concept,
  keyPoints,
  narrationText,
  figure,
  pageFigure,
}: {
  chunkId: string;
  concept: string;
  keyPoints: string[];
  /** Most recent sentence Rose said aloud — drives the active scene. */
  narrationText?: string;
  /** A table / diagram / page pulled from the student's own upload. */
  figure?: IngestSourceImageRecord | null;
  pageFigure?: IngestSourceImageRecord | null;
}) {
  const points = useMemo(
    () => keyPoints.map((p) => p.trim()).filter((p) => p.length > 0),
    [keyPoints]
  );

  const hasFigureScene = Boolean(figure);

  const beats = useMemo<Beat[]>(() => {
    const b: Beat[] = [{ kind: "title" }];
    points.forEach((_, i) => b.push({ kind: "point", index: i }));
    if (hasFigureScene) b.push({ kind: "figure" });
    return b;
  }, [points, hasFigureScene]);

  const [beatIdx, setBeatIdx] = useState(0);

  // New concept → start from the title scene.
  useEffect(() => {
    setBeatIdx(0);
  }, [chunkId]);

  // Keep the index in range if the beat list shrinks (e.g. figure clears).
  useEffect(() => {
    setBeatIdx((i) => Math.min(i, Math.max(0, beats.length - 1)));
  }, [beats.length]);

  // Voice mode: follow what Rose is narrating right now.
  useEffect(() => {
    if (!narrationText) return;
    const m = bestMatchIndex(points, narrationText);
    if (m >= 0) {
      const target = beats.findIndex(
        (b) => b.kind === "point" && b.index === m
      );
      if (target >= 0) {
        setBeatIdx(target);
        return;
      }
    }
    if (hasFigureScene && mentionsVisual(narrationText)) {
      const target = beats.findIndex((b) => b.kind === "figure");
      if (target >= 0) setBeatIdx(target);
    }
  }, [narrationText, points, beats, hasFigureScene]);

  // Text / silent mode: gently auto-advance so the board keeps moving.
  // Disabled while narration is actively driving (voice mode), since the
  // last spoken sentence stays set and should own the scene.
  useEffect(() => {
    if (narrationText) return;
    if (beats.length <= 1) return;
    if (beatIdx >= beats.length - 1) return;
    const delay = beats[beatIdx]?.kind === "title" ? 2800 : 5200;
    const id = window.setTimeout(
      () => setBeatIdx((i) => Math.min(i + 1, beats.length - 1)),
      delay
    );
    return () => window.clearTimeout(id);
  }, [beatIdx, beats, narrationText]);

  const active = beats[Math.min(beatIdx, beats.length - 1)] ?? { kind: "title" };

  // Figure scene state — flip between the cropped figure and the full page.
  const canTogglePage = Boolean(
    pageFigure && (!figure || pageFigure.url !== figure.url)
  );
  const [figView, setFigView] = useState<"figure" | "page">("figure");
  useEffect(() => {
    setFigView("figure");
  }, [chunkId]);
  const shownFigure = figView === "page" && pageFigure ? pageFigure : figure;

  return (
    <section
      aria-label="Lesson whiteboard"
      className="slide-board relative mx-auto flex w-full flex-col overflow-hidden rounded-[1.75rem] border border-white/50 bg-white/25 shadow-[0_30px_80px_-30px_rgba(60,60,90,0.35)] ring-1 ring-white/40 backdrop-blur-2xl backdrop-saturate-150"
    >
      <div
        aria-hidden
        className="slide-grid pointer-events-none absolute inset-0"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-6 top-0 h-px rounded-full"
        style={{
          background:
            "linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.9) 50%, rgba(255,255,255,0) 100%)",
        }}
      />

      {/* Persistent context strip — always shows what we're teaching so the
          board never loses its anchor as scenes change. */}
      <div className="relative flex items-center justify-between gap-3 px-6 pt-5 sm:px-8">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-fuchsia-600/80">
            Now teaching
          </p>
          <p className="mt-0.5 truncate text-sm font-medium text-zinc-600">
            {concept}
          </p>
        </div>
      </div>

      {/* Stage — the active scene. Keyed by beat so each transition fades. */}
      <div className="relative flex min-h-[clamp(20rem,46vh,30rem)] flex-1 items-center justify-center px-6 py-8 sm:px-10">
        <div key={`${chunkId}-${beatIdx}`} className="slide-scene w-full">
          {active.kind === "title" ? (
            <div className="mx-auto max-w-3xl text-center">
              <h2 className="text-3xl font-semibold leading-tight tracking-tight text-zinc-900 sm:text-4xl">
                {concept}
              </h2>
            </div>
          ) : active.kind === "point" ? (
            <div className="mx-auto flex max-w-3xl items-start gap-5">
              <span className="select-none text-5xl font-bold leading-none text-fuchsia-300 sm:text-6xl">
                {String(active.index + 1).padStart(2, "0")}
              </span>
              <p className="pt-1 text-2xl font-medium leading-snug text-zinc-900 sm:text-3xl">
                {points[active.index]}
              </p>
            </div>
          ) : (
            <div className="mx-auto w-full max-w-3xl">
              {figure ? (
                <figure className="overflow-hidden rounded-2xl border border-white/60 bg-white/80 shadow-sm ring-1 ring-white/50">
                  <div className="flex items-center justify-between gap-2 border-b border-white/60 px-3 py-2">
                    <span className="truncate text-[11px] font-medium text-zinc-500">
                      {shownFigure?.label || locatorLabel(shownFigure)}
                    </span>
                    {canTogglePage ? (
                      <div
                        className="flex shrink-0 items-center rounded-full border border-zinc-200 bg-white/70 p-0.5 text-[11px] font-medium"
                        role="tablist"
                        aria-label="Figure view"
                      >
                        <button
                          type="button"
                          role="tab"
                          aria-selected={figView === "figure"}
                          onClick={() => setFigView("figure")}
                          className={
                            figView === "figure"
                              ? "rounded-full bg-zinc-900 px-2.5 py-0.5 text-white"
                              : "rounded-full px-2.5 py-0.5 text-zinc-600 hover:text-zinc-900"
                          }
                        >
                          Figure
                        </button>
                        <button
                          type="button"
                          role="tab"
                          aria-selected={figView === "page"}
                          onClick={() => setFigView("page")}
                          className={
                            figView === "page"
                              ? "rounded-full bg-zinc-900 px-2.5 py-0.5 text-white"
                              : "rounded-full px-2.5 py-0.5 text-zinc-600 hover:text-zinc-900"
                          }
                        >
                          Page
                        </button>
                      </div>
                    ) : null}
                  </div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    key={shownFigure?.url}
                    src={shownFigure?.url}
                    alt={
                      shownFigure?.label ||
                      `Figure from ${shownFigure?.sourceFileName}`
                    }
                    className="block max-h-[26rem] w-full bg-white object-contain"
                  />
                  <figcaption className="px-3 py-2 text-[11px] text-zinc-500">
                    {shownFigure?.sourceFileName}
                    {shownFigure && shownFigure.anchorType !== "document"
                      ? ` · ${locatorLabel(shownFigure)}`
                      : ""}
                  </figcaption>
                </figure>
              ) : (
                <div
                  className="mx-auto h-56 max-w-md animate-pulse rounded-2xl bg-gradient-to-br from-white/70 to-white/40"
                  aria-busy="true"
                  aria-label="Rose is sketching this out…"
                />
              )}
            </div>
          )}
        </div>
      </div>

      {/* Scene progress dots — tap to jump. */}
      {beats.length > 1 ? (
        <div className="relative flex items-center justify-center gap-1.5 pb-5">
          {beats.map((b, i) => (
            <button
              key={i}
              type="button"
              aria-label={
                b.kind === "title"
                  ? "Title"
                  : b.kind === "figure"
                    ? "Figure"
                    : `Point ${b.index + 1}`
              }
              onClick={() => setBeatIdx(i)}
              className={
                i === beatIdx
                  ? "h-1.5 w-6 rounded-full bg-fuchsia-500 transition-all"
                  : "h-1.5 w-1.5 rounded-full bg-zinc-300 transition-all hover:bg-zinc-400"
              }
            />
          ))}
        </div>
      ) : null}

      <style jsx>{`
        .slide-grid {
          background-image: radial-gradient(
            rgba(99, 102, 241, 0.1) 1px,
            transparent 1px
          );
          background-size: 24px 24px;
          mask-image: linear-gradient(
            to bottom,
            rgba(0, 0, 0, 0.5),
            rgba(0, 0, 0, 0.08)
          );
        }
        .slide-scene {
          animation: slide-scene-in 0.5s cubic-bezier(0.22, 0.61, 0.36, 1) both;
        }
        @keyframes slide-scene-in {
          0% {
            opacity: 0;
            transform: translateY(10px) scale(0.99);
          }
          100% {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .slide-scene {
            animation: none;
          }
        }
      `}</style>
    </section>
  );
}

function locatorLabel(fig?: IngestSourceImageRecord | null): string {
  if (!fig) return "";
  if (fig.anchorType === "page") return `page ${fig.anchorIndex}`;
  if (fig.anchorType === "slide") return `slide ${fig.anchorIndex}`;
  return "your material";
}

function mentionsVisual(s: string): boolean {
  return /\b(diagram|figure|table|image|picture|chart|graph|illustration|shown|shows|look at|see here|this graphic|map|drawing)\b/i.test(
    s
  );
}

// ---------------------------------------------------------------------------
// Narration ↔ point matching (which point is Rose on right now)
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  "the","a","an","and","or","but","of","in","to","for","on","at","by","with","as",
  "is","are","was","were","be","been","being","this","that","these","those",
  "it","its","we","you","they","them","their","our","your","his","her","i","me",
  "my","if","so","do","does","did","have","has","had","can","could","should",
  "would","will","shall","not","no","yes","from","into","about","what","when",
  "where","why","how","who","which","just","than","then","there","here","also",
]);

function tokenize(s: string): string[] {
  return (
    s
      .toLowerCase()
      .match(/[a-z][a-z'-]{2,}/g)
      ?.filter((w) => !STOP_WORDS.has(w)) ?? []
  );
}

function bestMatchIndex(points: string[], narration: string): number {
  const narr = new Set(tokenize(narration));
  if (narr.size < 2) return -1;
  let bestIdx = -1;
  let bestScore = 0;
  for (let i = 0; i < points.length; i += 1) {
    let score = 0;
    for (const w of tokenize(points[i])) if (narr.has(w)) score += 1;
    if (score >= 2 && score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestIdx;
}

export const SlideStage = memo(SlideStageImpl);
