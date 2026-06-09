"use client";

import { memo, useMemo } from "react";
import type { WhiteboardAction } from "@/types/mentored";
import {
  overlayDrawableActions,
  WHITEBOARD_COLORS,
} from "@/lib/mentored/whiteboard-utils";

/**
 * Persistent live canvas — accumulates tutor marks on top of the beat
 * carousel. Does not replace SlideStage beats; renders as an overlay
 * substrate (anchored table + SVG annotations).
 */

function MarkdownTablePreview({ markdown }: { markdown: string }) {
  const rows = useMemo(() => {
    return markdown
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.includes("|") && !/^[\|\s:-]+$/.test(l))
      .slice(0, 10)
      .map((line) =>
        line
          .split("|")
          .map((c) => c.trim())
          .filter(Boolean)
      );
  }, [markdown]);

  if (rows.length === 0) {
    return (
      <pre className="max-h-[26rem] overflow-auto p-3 text-[11px] text-zinc-700">
        {markdown.slice(0, 800)}
      </pre>
    );
  }

  return (
    <div className="max-h-[min(26rem,42vh)] overflow-y-auto overscroll-y-contain">
      <table className="w-full table-auto border-collapse text-left text-[11px] leading-normal">
        <tbody>
          {rows.map((cells, ri) => (
            <tr
              key={ri}
              className={
                ri === 0 ? "bg-zinc-100/90 font-semibold" : "border-t border-zinc-200/80"
              }
            >
              {cells.map((cell, ci) => (
                <td
                  key={ci}
                  className="whitespace-normal px-2 py-1.5 align-top text-zinc-800"
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

export function LiveOverlaySvg({ actions }: { actions: WhiteboardAction[] }) {
  const drawable = overlayDrawableActions(actions);
  if (drawable.length === 0) return null;

  return (
    <svg
      className="pointer-events-none absolute inset-0"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden
    >
      <defs>
        <marker
          id="live-wb-arrowhead"
          markerWidth="4"
          markerHeight="4"
          refX="3"
          refY="2"
          orient="auto"
        >
          <path d="M0,0 L4,2 L0,4 Z" fill="currentColor" />
        </marker>
      </defs>
      {drawable.map((action, i) => {
        const colorKey =
          action.type === "highlight_bbox" ||
          action.type === "draw_arrow" ||
          action.type === "add_label"
            ? (action.color ?? "default")
            : "default";
        const palette = WHITEBOARD_COLORS[colorKey];

        if (action.type === "highlight_bbox") {
          const [x, y, w, h] = action.bbox;
          return (
            <rect
              key={action.id ?? `hl-${i}`}
              x={x}
              y={y}
              width={w}
              height={h}
              fill={palette.fill}
              stroke={palette.stroke}
              strokeWidth="0.25"
              rx="0.4"
              className="live-wb-draw"
            />
          );
        }
        if (action.type === "draw_arrow") {
          return (
            <g
              key={action.id ?? `arr-${i}`}
              className="live-wb-draw"
              style={{ color: palette.stroke }}
            >
              <line
                x1={action.from.x}
                y1={action.from.y}
                x2={action.to.x}
                y2={action.to.y}
                stroke={palette.stroke}
                strokeWidth="0.35"
                markerEnd="url(#live-wb-arrowhead)"
              />
            </g>
          );
        }
        if (action.type === "add_label") {
          return (
            <g key={action.id ?? `lbl-${i}`} className="live-wb-draw">
              <rect
                x={action.position.x - 1}
                y={action.position.y - 2.5}
                width={Math.min(28, action.text.length * 1.2 + 2)}
                height="4"
                rx="0.8"
                fill={palette.labelBg}
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
    </svg>
  );
}

function LiveWhiteboardLayerImpl({
  tableMarkdown,
  tableAnchored,
  liveActions,
  assetImageUrl,
  assetCaption,
  hideSubstrate = false,
}: {
  tableMarkdown?: string | null;
  tableAnchored: boolean;
  liveActions: WhiteboardAction[];
  /** Cropped PDF figure/diagram for show_asset actions. */
  assetImageUrl?: string | null;
  assetCaption?: string | null;
  /** When the table beat already shows the full substrate in the carousel. */
  hideSubstrate?: boolean;
}) {
  const showAsset = Boolean(assetImageUrl?.trim()) && !hideSubstrate;
  const hasTableMarkdown = Boolean(tableMarkdown?.trim());
  const showTable = tableAnchored && hasTableMarkdown && !hideSubstrate;
  const drawable = overlayDrawableActions(liveActions);

  if (!showAsset && !showTable && drawable.length === 0) return null;
  // Anchored table expected but markdown missing — hide empty dashed placeholder.
  if (tableAnchored && !hasTableMarkdown && !showAsset) return null;

  return (
    <div
      className="pointer-events-none w-full shrink-0"
      aria-label="Live whiteboard canvas"
    >
      {showTable && tableMarkdown ? (
        <figure className="rounded-xl border border-fuchsia-200/50 bg-white/90 shadow-md ring-1 ring-white/60">
          <div className="flex shrink-0 items-center gap-2 border-b border-zinc-100 px-3 py-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-fuchsia-600/80">
              Anchored
            </span>
            <span className="truncate text-[10px] text-zinc-500">
              Source table
            </span>
          </div>
          <div className="relative shrink-0 bg-white">
            <MarkdownTablePreview markdown={tableMarkdown} />
            {drawable.length > 0 ? (
              <LiveOverlaySvg actions={liveActions} />
            ) : null}
          </div>
        </figure>
      ) : showAsset && assetImageUrl ? (
        <figure className="overflow-hidden rounded-xl border border-fuchsia-200/50 bg-white/90 shadow-md ring-1 ring-white/60">
          <div className="flex shrink-0 items-center gap-2 border-b border-zinc-100 px-3 py-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-fuchsia-600/80">
              Anchored
            </span>
            <span className="truncate text-[10px] text-zinc-500">
              {assetCaption?.trim() || "Source figure"}
            </span>
          </div>
          <div className="relative shrink-0 bg-white">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={assetImageUrl}
              alt={assetCaption?.trim() || "Figure from your upload"}
              className="block h-auto max-h-[min(26rem,42vh)] w-full object-contain"
            />
            {drawable.length > 0 ? (
              <LiveOverlaySvg actions={liveActions} />
            ) : null}
          </div>
        </figure>
      ) : drawable.length > 0 ? (
        <div className="relative min-h-[6rem] shrink-0 rounded-xl border border-dashed border-fuchsia-200/40 bg-white/40">
          <LiveOverlaySvg actions={liveActions} />
        </div>
      ) : null}

      <style jsx>{`
        .live-wb-draw {
          animation: live-wb-in 0.45s cubic-bezier(0.22, 0.61, 0.36, 1) both;
        }
        @keyframes live-wb-in {
          0% {
            opacity: 0;
            stroke-dashoffset: 8;
          }
          100% {
            opacity: 1;
            stroke-dashoffset: 0;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .live-wb-draw {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}

export const LiveWhiteboardLayer = memo(LiveWhiteboardLayerImpl);
