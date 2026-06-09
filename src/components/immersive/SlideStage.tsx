"use client";

import { memo, useEffect, useMemo, useState } from "react";
import {
  LiveOverlaySvg,
  LiveWhiteboardLayer,
} from "@/components/immersive/LiveWhiteboardLayer";
import type { WhiteboardAction } from "@/types/mentored";
import {
  overlayDrawableActions,
  visibleLiveActions,
} from "@/lib/mentored/whiteboard-utils";

/**
 * The whiteboard — concept headline, key points, optional markdown table,
 * and tutor overlay actions (highlights, arrows, labels).
 */

type Beat =
  | { kind: "title" }
  | { kind: "point"; index: number }
  | { kind: "figure" }
  | { kind: "table" };

function WhiteboardOverlay({ actions }: { actions: WhiteboardAction[] }) {
  const visible = actions.filter(
    (a) =>
      a.type !== "clear" &&
      a.type !== "show_asset" &&
      a.type !== "highlight_bbox"
  );
  if (visible.length === 0) return null;

  return (
    <svg
      className="pointer-events-none absolute inset-0"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden
    >
      {visible.map((action, i) => {
        if (action.type === "draw_arrow") {
          return (
            <g key={`arr-${i}`}>
              <line
                x1={action.from.x}
                y1={action.from.y}
                x2={action.to.x}
                y2={action.to.y}
                stroke="rgba(217,70,239,0.9)"
                strokeWidth="0.35"
                markerEnd="url(#wb-arrowhead)"
              />
            </g>
          );
        }
        if (action.type === "add_label") {
          return (
            <g key={`lbl-${i}`}>
              <rect
                x={action.position.x - 1}
                y={action.position.y - 2.5}
                width={Math.min(28, action.text.length * 1.2 + 2)}
                height="4"
                rx="0.8"
                fill="rgba(24,24,27,0.82)"
              />
              <text
                x={action.position.x}
                y={action.position.y}
                fill="white"
                fontSize="2.2"
                fontWeight="600"
              >
                {action.text.slice(0, 40)}
              </text>
            </g>
          );
        }
        return null;
      })}
      <defs>
        <marker
          id="wb-arrowhead"
          markerWidth="4"
          markerHeight="4"
          refX="3"
          refY="2"
          orient="auto"
        >
          <path d="M0,0 L4,2 L0,4 Z" fill="rgba(217,70,239,0.9)" />
        </marker>
      </defs>
    </svg>
  );
}

function MarkdownTablePreview({ markdown }: { markdown: string }) {
  const rows = useMemo(() => {
    return markdown
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.includes("|") && !/^[\|\s:-]+$/.test(l))
      .slice(0, 8)
      .map((line) =>
        line
          .split("|")
          .map((c) => c.trim())
          .filter(Boolean)
      );
  }, [markdown]);

  if (rows.length === 0) {
    return (
      <pre className="max-h-[26rem] overflow-auto p-4 text-xs text-zinc-700">
        {markdown.slice(0, 1200)}
      </pre>
    );
  }

  return (
    <div className="max-h-[min(26rem,42vh)] overflow-y-auto overscroll-y-contain">
      <table className="w-full table-auto border-collapse text-left text-xs leading-normal">
        <tbody>
          {rows.map((cells, ri) => (
            <tr
              key={ri}
              className={ri === 0 ? "bg-zinc-100 font-semibold" : "border-t border-zinc-200"}
            >
              {cells.map((cell, ci) => (
                <td
                  key={ci}
                  className="whitespace-normal px-3 py-2 align-top text-zinc-800"
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SlideStageImpl({
  chunkId,
  concept,
  keyPoints,
  narrationText,
  tableMarkdown,
  autoAdvanceEnabled = false,
  preferTableBeat = false,
  whiteboardActions = [],
  liveCanvasEnabled = false,
  liveCanvasState,
  assetImageUrl,
  assetCaption,
}: {
  chunkId: string;
  concept: string;
  keyPoints: string[];
  narrationText?: string;
  tableMarkdown?: string | null;
  autoAdvanceEnabled?: boolean;
  preferTableBeat?: boolean;
  whiteboardActions?: WhiteboardAction[];
  /** When true, renders the persistent live canvas overlay (additive). */
  liveCanvasEnabled?: boolean;
  /** Accumulated live-canvas actions + reveal state from the runner. */
  liveCanvasState?: {
    actions: WhiteboardAction[];
    tableAnchored?: boolean;
    revealedCount?: number;
    assetId?: string | null;
  };
  assetImageUrl?: string | null;
  assetCaption?: string | null;
}) {
  const points = useMemo(
    () => keyPoints.map((p) => p.trim()).filter((p) => p.length > 0),
    [keyPoints]
  );

  const hasTableScene = Boolean(tableMarkdown?.trim());
  const hasFigureScene = Boolean(assetImageUrl?.trim());

  const beats = useMemo<Beat[]>(() => {
    const b: Beat[] = [{ kind: "title" }];
    points.forEach((_, i) => b.push({ kind: "point", index: i }));
    if (hasFigureScene) b.push({ kind: "figure" });
    if (hasTableScene) b.push({ kind: "table" });
    return b;
  }, [hasFigureScene, hasTableScene, points]);

  const [beatIdx, setBeatIdx] = useState(0);

  useEffect(() => {
    setBeatIdx(0);
  }, [chunkId]);

  useEffect(() => {
    setBeatIdx((i) => Math.min(i, Math.max(0, beats.length - 1)));
  }, [beats.length]);

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
    if (mentionsVisual(narrationText)) {
      const tableTarget = beats.findIndex((b) => b.kind === "table");
      const figureTarget = beats.findIndex((b) => b.kind === "figure");
      const target = tableTarget >= 0 ? tableTarget : figureTarget;
      if (target >= 0) setBeatIdx(target);
    }
  }, [narrationText, points, beats]);

  useEffect(() => {
    if (!autoAdvanceEnabled) return;
    if (narrationText) return;
    if (beats.length <= 1) return;
    if (beatIdx >= beats.length - 1) return;
    const delay = beats[beatIdx]?.kind === "title" ? 2800 : 5200;
    const id = window.setTimeout(
      () => setBeatIdx((i) => Math.min(i + 1, beats.length - 1)),
      delay
    );
    return () => window.clearTimeout(id);
  }, [autoAdvanceEnabled, beatIdx, beats, narrationText]);

  useEffect(() => {
    if (!preferTableBeat || !hasTableScene) return;
    const target = beats.findIndex((b) => b.kind === "table");
    if (target >= 0) setBeatIdx(target);
  }, [preferTableBeat, hasTableScene, beats]);

  const active = beats[Math.min(beatIdx, beats.length - 1)] ?? { kind: "title" };

  const liveCanvas = useMemo(() => {
    if (!liveCanvasEnabled || !liveCanvasState) {
      return { actions: [] as WhiteboardAction[], tableAnchored: false };
    }
    return visibleLiveActions(
      {
        actions: liveCanvasState.actions,
        tableAnchored: liveCanvasState.tableAnchored,
        revealedCount: liveCanvasState.revealedCount,
      },
      narrationText ?? ""
    );
  }, [liveCanvasEnabled, liveCanvasState, narrationText]);

  const overlayActions = useMemo(() => {
    if (active.kind !== "table" && active.kind !== "figure") return [];
    if (liveCanvasEnabled && liveCanvas.actions.length > 0) {
      return overlayDrawableActions(liveCanvas.actions);
    }
    return whiteboardActions.filter(
      (a) =>
        a.type !== "clear" &&
        a.type !== "show_asset" &&
        a.type !== "show_table" &&
        a.type !== "clear_except"
    );
  }, [active.kind, liveCanvas.actions, liveCanvasEnabled, whiteboardActions]);

  return (
    <section
      aria-label="Lesson whiteboard"
      className="slide-board relative mx-auto flex w-full flex-col overflow-hidden rounded-[1.75rem] border border-white/50 bg-white/25 shadow-[0_30px_80px_-30px_rgba(60,60,90,0.35)] ring-1 ring-white/40 backdrop-blur-2xl backdrop-saturate-150"
    >
      <div aria-hidden className="slide-grid pointer-events-none absolute inset-0" />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-6 top-0 h-px rounded-full"
        style={{
          background:
            "linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.9) 50%, rgba(255,255,255,0) 100%)",
        }}
      />

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

      <div className="relative grid min-h-[clamp(20rem,46vh,30rem)] flex-1 grid-rows-[minmax(0,1fr)_auto] gap-y-4 px-6 py-8 sm:px-10">
        <div
          key={`${chunkId}-${beatIdx}`}
          className="slide-scene flex min-h-0 w-full items-center justify-center self-center"
        >
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
          ) : active.kind === "figure" && assetImageUrl ? (
            <div className="mx-auto w-full max-w-3xl">
              <figure className="overflow-hidden rounded-2xl border border-white/60 bg-white/80 shadow-sm ring-1 ring-white/50">
                <div className="flex items-center justify-between gap-2 border-b border-white/60 px-3 py-2">
                  <span className="truncate text-[11px] font-medium text-zinc-500">
                    {assetCaption?.trim() || "Figure from your upload"}
                  </span>
                </div>
                <div className="relative bg-white">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={assetImageUrl}
                    alt={assetCaption?.trim() || "Figure from your upload"}
                    className="block h-auto max-h-[26rem] w-full object-contain"
                  />
                  {liveCanvasEnabled ? (
                    <LiveOverlaySvg actions={overlayActions} />
                  ) : (
                    <WhiteboardOverlay actions={overlayActions} />
                  )}
                </div>
              </figure>
            </div>
          ) : (
            <div className="mx-auto w-full max-w-3xl">
              {tableMarkdown ? (
                <figure className="overflow-hidden rounded-2xl border border-white/60 bg-white/80 shadow-sm ring-1 ring-white/50">
                  <div className="flex items-center justify-between gap-2 border-b border-white/60 px-3 py-2">
                    <span className="truncate text-[11px] font-medium text-zinc-500">
                      Table from your upload
                    </span>
                  </div>
                  <div className="relative bg-white">
                    <MarkdownTablePreview markdown={tableMarkdown} />
                    {liveCanvasEnabled ? (
                      <LiveOverlaySvg actions={overlayActions} />
                    ) : (
                      <WhiteboardOverlay actions={overlayActions} />
                    )}
                  </div>
                </figure>
              ) : null}
            </div>
          )}
        </div>
        {liveCanvasEnabled ? (
          <div className="relative z-10 w-full shrink-0 self-end">
            <LiveWhiteboardLayer
              tableMarkdown={tableMarkdown}
              tableAnchored={
                liveCanvas.tableAnchored && Boolean(tableMarkdown?.trim())
              }
              liveActions={liveCanvas.actions}
              assetImageUrl={assetImageUrl}
              assetCaption={assetCaption}
              hideSubstrate={active.kind === "table" || active.kind === "figure"}
            />
          </div>
        ) : null}
      </div>

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
                    : b.kind === "table"
                      ? "Table"
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

function mentionsVisual(s: string): boolean {
  return (
    /\b(table|chart|grid|shown|shows|look at|see here)\b/i.test(s) ||
    /(표|도표|여기|보세요|참고)/.test(s)
  );
}

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
