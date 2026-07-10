"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

const DIM_KEY = "aroses.liveNotes.previewDim";
const POS_KEY = "aroses.liveNotes.previewPos";

const DEFAULT_W = 400;
const DEFAULT_H = 240;
const MIN_W = 220;
const MIN_H = 140;
const HEADER_H = 36;
const MIRROR_H = 88;
const COLLAPSED_W = 220;
const COLLAPSED_H = 44;
const MARGIN = 16;
const ASPECT = 16 / 9;

type Pos = { x: number; y: number };
type Dim = { w: number; h: number };

type ResizeEdge =
  | "e"
  | "s"
  | "se"
  | "sw"
  | "ne"
  | "nw"
  | "w"
  | "n";

function clampPos(pos: Pos, w: number, h: number): Pos {
  if (typeof window === "undefined") return pos;
  const maxX = Math.max(MARGIN, window.innerWidth - w - MARGIN);
  const maxY = Math.max(MARGIN, window.innerHeight - h - MARGIN);
  return {
    x: Math.min(maxX, Math.max(MARGIN, pos.x)),
    y: Math.min(maxY, Math.max(MARGIN, pos.y)),
  };
}

function maxDimAt(pos: Pos, chromeH: number): Dim {
  if (typeof window === "undefined") {
    return { w: 900, h: 560 };
  }
  return {
    w: Math.max(MIN_W, window.innerWidth - pos.x - MARGIN),
    h: Math.max(MIN_H, window.innerHeight - pos.y - MARGIN - chromeH),
  };
}

function clampDim(dim: Dim, pos: Pos, chromeH: number): Dim {
  const max = maxDimAt(pos, chromeH);
  return {
    w: Math.min(max.w, Math.max(MIN_W, Math.round(dim.w))),
    h: Math.min(max.h, Math.max(MIN_H, Math.round(dim.h))),
  };
}

function defaultPos(w: number, h: number): Pos {
  if (typeof window === "undefined") return { x: MARGIN, y: 400 };
  return clampPos(
    { x: MARGIN, y: window.innerHeight - h - MARGIN },
    w,
    h
  );
}

function readStoredDim(): Dim {
  try {
    const raw = localStorage.getItem(DIM_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Dim>;
      if (typeof parsed.w === "number" && typeof parsed.h === "number") {
        return {
          w: Math.max(MIN_W, Math.min(1200, parsed.w)),
          h: Math.max(MIN_H, Math.min(800, parsed.h)),
        };
      }
    }
    // Migrate old preset key if present.
    const legacy = localStorage.getItem("aroses.liveNotes.previewSize");
    if (legacy === "compact") return { w: 280, h: 168 };
    if (legacy === "large") return { w: 560, h: 336 };
  } catch {
    /* ignore */
  }
  return { w: DEFAULT_W, h: DEFAULT_H };
}

function readStoredPos(dim: Dim, chromeH: number): Pos {
  const panelW = dim.w;
  const panelH = chromeH + dim.h;
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Pos>;
      if (typeof parsed.x === "number" && typeof parsed.y === "number") {
        return clampPos({ x: parsed.x, y: parsed.y }, panelW, panelH);
      }
    }
  } catch {
    /* ignore */
  }
  return defaultPos(panelW, panelH);
}

/**
 * Floating, draggable + resizable lecture preview (PiP-style).
 * Drag the header to move; drag edges/corners to resize.
 */
export function LecturePreviewPanel({
  stream,
  collapsed,
  onCollapsedChange,
  mirrorWarning,
  onDismissMirror,
  onReshare,
}: {
  stream: MediaStream | null;
  collapsed: boolean;
  onCollapsedChange: (v: boolean) => void;
  mirrorWarning: boolean;
  onDismissMirror: () => void;
  onReshare?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const moveRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);
  const resizeRef = useRef<{
    pointerId: number;
    edge: ResizeEdge;
    startX: number;
    startY: number;
    origW: number;
    origH: number;
    origX: number;
    origY: number;
    lockAspect: boolean;
  } | null>(null);

  const chromeH = HEADER_H + (mirrorWarning && !collapsed ? MIRROR_H : 0);

  const [level, setLevel] = useState(0);
  const [dim, setDim] = useState<Dim>(() =>
    typeof window === "undefined"
      ? { w: DEFAULT_W, h: DEFAULT_H }
      : readStoredDim()
  );
  const [pos, setPos] = useState<Pos>(() =>
    typeof window === "undefined"
      ? { x: MARGIN, y: 400 }
      : readStoredPos(readStoredDim(), HEADER_H)
  );
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(false);

  const dimRef = useRef(dim);
  dimRef.current = dim;
  const posRef = useRef(pos);
  posRef.current = pos;

  const panelW = collapsed ? COLLAPSED_W : dim.w;
  const panelH = collapsed ? COLLAPSED_H : chromeH + dim.h;

  // Keep the chip/panel on-screen when size changes — don't jump to a corner.
  useEffect(() => {
    setPos((p) => {
      const next = clampPos(p, panelW, panelH);
      posRef.current = next;
      return next;
    });
  }, [panelW, panelH]);

  const persistDim = useCallback((next: Dim) => {
    setDim(next);
    try {
      localStorage.setItem(DIM_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, []);

  const persistPos = useCallback((next: Pos) => {
    setPos(next);
    try {
      localStorage.setItem(POS_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, []);

  const attachStream = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    const live = Boolean(
      stream?.getVideoTracks().some((t) => t.readyState === "live")
    );
    // Minimized: detach so Chrome stops decoding a second video pipeline
    // (FrameSampler keeps its own decoder for slide vision when enabled).
    if (!stream || !live || collapsed) {
      el.pause();
      el.srcObject = null;
      return;
    }
    if (el.srcObject !== stream) {
      el.srcObject = stream;
    }
    el.muted = true;
    el.playsInline = true;
    el.setAttribute("playsinline", "true");
    void el.play().catch(() => {});
  }, [stream, collapsed]);

  const setVideoNode = useCallback(
    (node: HTMLVideoElement | null) => {
      videoRef.current = node;
      if (node) attachStream();
    },
    [attachStream]
  );

  useLayoutEffect(() => {
    attachStream();
    const el = videoRef.current;
    if (!el || !stream) return;
    const kick = () => {
      void el.play().catch(() => {});
    };
    el.addEventListener("loadedmetadata", kick);
    el.addEventListener("loadeddata", kick);
    const t = window.setTimeout(kick, 80);
    return () => {
      el.removeEventListener("loadedmetadata", kick);
      el.removeEventListener("loadeddata", kick);
      window.clearTimeout(t);
    };
  }, [attachStream, stream, collapsed]);

  useEffect(() => {
    const audioTrack = stream?.getAudioTracks()[0];
    if (!audioTrack || audioTrack.readyState !== "live" || collapsed) {
      setLevel(0);
      return;
    }
    let ctx: AudioContext | null = null;
    let timer = 0;
    try {
      ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(new MediaStream([audioTrack]));
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      // ~8fps meter — RAF was re-rendering the panel ~60×/sec and caused lag.
      timer = window.setInterval(() => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i]! - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        setLevel(Math.min(1, rms * 4));
      }, 120) as unknown as number;
    } catch {
      setLevel(0);
    }
    return () => {
      window.clearInterval(timer);
      void ctx?.close();
    };
  }, [stream, collapsed]);

  useEffect(() => {
    const onWinResize = () => {
      const d = clampDim(dimRef.current, posRef.current, chromeH);
      const p = clampPos(posRef.current, d.w, chromeH + d.h);
      setDim(d);
      setPos(p);
    };
    window.addEventListener("resize", onWinResize);
    return () => window.removeEventListener("resize", onWinResize);
  }, [chromeH]);

  const onMovePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("button")) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    moveRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origX: pos.x,
      origY: pos.y,
    };
    setDragging(true);
  };

  const onMovePointerMove = (e: React.PointerEvent) => {
    const drag = moveRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    setPos(
      clampPos(
        {
          x: drag.origX + (e.clientX - drag.startX),
          y: drag.origY + (e.clientY - drag.startY),
        },
        panelW,
        panelH
      )
    );
  };

  const endMove = (e: React.PointerEvent) => {
    const drag = moveRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    moveRef.current = null;
    setDragging(false);
    const next = clampPos(posRef.current, panelW, panelH);
    setPos(next);
    posRef.current = next;
    persistPos(next);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const onResizePointerDown = (edge: ResizeEdge, lockAspect: boolean) =>
    (e: React.PointerEvent) => {
      if (e.button !== 0 || collapsed) return;
      e.preventDefault();
      e.stopPropagation();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      resizeRef.current = {
        pointerId: e.pointerId,
        edge,
        startX: e.clientX,
        startY: e.clientY,
        origW: dim.w,
        origH: dim.h,
        origX: pos.x,
        origY: pos.y,
        lockAspect,
      };
      setResizing(true);
    };

  const onResizePointerMove = (e: React.PointerEvent) => {
    const r = resizeRef.current;
    if (!r || r.pointerId !== e.pointerId) return;
    const dx = e.clientX - r.startX;
    const dy = e.clientY - r.startY;
    let nextW = r.origW;
    let nextH = r.origH;
    let nextX = r.origX;
    let nextY = r.origY;

    if (r.edge.includes("e")) nextW = r.origW + dx;
    if (r.edge.includes("w")) {
      nextW = r.origW - dx;
      nextX = r.origX + dx;
    }
    if (r.edge.includes("s")) nextH = r.origH + dy;
    if (r.edge.includes("n")) {
      nextH = r.origH - dy;
      nextY = r.origY + dy;
    }

    if (r.lockAspect) {
      // Prefer the dominant delta so corner drags feel natural.
      if (Math.abs(dx) >= Math.abs(dy) || r.edge === "e" || r.edge === "w") {
        nextH = Math.round(nextW / ASPECT);
        if (r.edge.includes("n")) {
          nextY = r.origY + (r.origH - nextH);
        }
      } else {
        nextW = Math.round(nextH * ASPECT);
        if (r.edge.includes("w")) {
          nextX = r.origX + (r.origW - nextW);
        }
      }
    }

    // Clamp size, then fix position so left/top edges don't jump past mins.
    const maxW =
      typeof window !== "undefined"
        ? window.innerWidth - MARGIN - (r.edge.includes("w") ? MARGIN : nextX)
        : 1200;
    const maxH =
      typeof window !== "undefined"
        ? window.innerHeight -
          MARGIN -
          chromeH -
          (r.edge.includes("n") ? MARGIN : nextY)
        : 800;

    nextW = Math.min(Math.max(MIN_W, nextW), Math.max(MIN_W, maxW));
    nextH = Math.min(Math.max(MIN_H, nextH), Math.max(MIN_H, maxH));

    if (r.edge.includes("w")) {
      nextX = r.origX + (r.origW - nextW);
    }
    if (r.edge.includes("n")) {
      nextY = r.origY + (r.origH - nextH);
    }

    const panelWNext = nextW;
    const panelHNext = chromeH + nextH;
    setDim({ w: nextW, h: nextH });
    setPos(clampPos({ x: nextX, y: nextY }, panelWNext, panelHNext));
  };

  const endResize = (e: React.PointerEvent) => {
    const r = resizeRef.current;
    if (!r || r.pointerId !== e.pointerId) return;
    resizeRef.current = null;
    setResizing(false);
    const next = clampDim(dimRef.current, posRef.current, chromeH);
    persistDim(next);
    persistPos(clampPos(posRef.current, next.w, chromeH + next.h));
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const hasVideo = Boolean(
    stream?.getVideoTracks().some((t) => t.readyState === "live")
  );

  if (!hasVideo) return null;

  const handleBase =
    "absolute z-10 touch-none bg-transparent hover:bg-rose-500/25";

  return (
    <div
      className={`pointer-events-auto fixed z-[60] flex flex-col overflow-hidden rounded-2xl border shadow-2xl ring-1 ${
        collapsed
          ? "border-rose-200 bg-white shadow-rose-900/20 ring-rose-100 dark:border-rose-900/50 dark:bg-zinc-950 dark:ring-rose-950/40"
          : "border-zinc-700/80 bg-zinc-950 shadow-black/40 ring-white/10"
      } ${dragging || resizing ? "select-none" : ""}`}
      style={{
        left: pos.x,
        top: pos.y,
        width: panelW,
        minHeight: collapsed ? COLLAPSED_H : undefined,
        touchAction: "none",
      }}
    >
      <div
        onPointerDown={onMovePointerDown}
        onPointerMove={onMovePointerMove}
        onPointerUp={endMove}
        onPointerCancel={endMove}
        className={`flex items-center justify-between gap-2 px-2.5 py-1.5 ${
          collapsed ? "cursor-grab" : "cursor-grab border-b border-zinc-800"
        } ${dragging ? "cursor-grabbing" : ""}`}
        title="Drag to move"
      >
        <div className="flex min-w-0 items-center gap-2">
          <AudioMeter level={level} />
          <p
            className={`truncate text-[11px] font-semibold ${
              collapsed
                ? "text-zinc-800 dark:text-zinc-100"
                : "text-zinc-300"
            }`}
          >
            Lecture
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {!collapsed ? (
            <button
              type="button"
              onClick={() => onCollapsedChange(true)}
              className="rounded-md px-2 py-1 text-[10px] font-semibold text-zinc-300 hover:bg-zinc-800 hover:text-white"
              title="Minimize"
            >
              Minimize
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onCollapsedChange(false)}
              className="rounded-full bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700"
            >
              Show lecture
            </button>
          )}
        </div>
      </div>

      {!collapsed && mirrorWarning ? (
        <div className="border-b border-amber-700/50 bg-amber-950/90 px-2.5 py-2 text-[11px] text-amber-100">
          <p className="font-medium">Wrong tab shared</p>
          <p className="mt-1 leading-relaxed text-amber-200/90">
            Share the <strong>lecture tab</strong>, not this Rose page, and
            tick &quot;Also share tab audio&quot;.
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {onReshare ? (
              <button
                type="button"
                onClick={onReshare}
                className="rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-semibold text-amber-950"
              >
                Re-share
              </button>
            ) : null}
            <button
              type="button"
              onClick={onDismissMirror}
              className="rounded-full border border-amber-600/60 px-2 py-0.5 text-[10px] font-medium text-amber-100"
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      <div
        className="relative bg-black"
        style={
          collapsed
            ? {
                position: "absolute",
                width: 1,
                height: 1,
                overflow: "hidden",
                opacity: 0,
                pointerEvents: "none",
              }
            : { height: dim.h }
        }
        aria-hidden={collapsed}
      >
        <video
          ref={setVideoNode}
          className="h-full w-full object-contain"
          muted
          playsInline
          autoPlay
        />
      </div>

      {/* Resize handles — edges free, corners keep ~16:9 */}
      {!collapsed ? (
        <>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize width"
            title="Drag to resize"
            className={`${handleBase} top-3 bottom-3 right-0 w-1.5 cursor-ew-resize`}
            onPointerDown={onResizePointerDown("e", false)}
            onPointerMove={onResizePointerMove}
            onPointerUp={endResize}
            onPointerCancel={endResize}
          />
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize height"
            title="Drag to resize"
            className={`${handleBase} left-3 right-3 bottom-0 h-1.5 cursor-ns-resize`}
            onPointerDown={onResizePointerDown("s", false)}
            onPointerMove={onResizePointerMove}
            onPointerUp={endResize}
            onPointerCancel={endResize}
          />
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize width"
            title="Drag to resize"
            className={`${handleBase} top-3 bottom-3 left-0 w-1.5 cursor-ew-resize`}
            onPointerDown={onResizePointerDown("w", false)}
            onPointerMove={onResizePointerMove}
            onPointerUp={endResize}
            onPointerCancel={endResize}
          />
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize height"
            title="Drag to resize"
            className={`${handleBase} left-3 right-3 top-0 h-1.5 cursor-ns-resize`}
            onPointerDown={onResizePointerDown("n", false)}
            onPointerMove={onResizePointerMove}
            onPointerUp={endResize}
            onPointerCancel={endResize}
          />
          <div
            role="separator"
            aria-label="Resize"
            title="Drag to resize"
            className={`${handleBase} bottom-0 right-0 h-4 w-4 cursor-nwse-resize`}
            onPointerDown={onResizePointerDown("se", true)}
            onPointerMove={onResizePointerMove}
            onPointerUp={endResize}
            onPointerCancel={endResize}
          >
            <span className="absolute bottom-1 right-1 h-2 w-2 rounded-sm border-b-2 border-r-2 border-zinc-400/80" />
          </div>
          <div
            role="separator"
            aria-label="Resize"
            title="Drag to resize"
            className={`${handleBase} bottom-0 left-0 h-4 w-4 cursor-nesw-resize`}
            onPointerDown={onResizePointerDown("sw", true)}
            onPointerMove={onResizePointerMove}
            onPointerUp={endResize}
            onPointerCancel={endResize}
          />
          <div
            role="separator"
            aria-label="Resize"
            title="Drag to resize"
            className={`${handleBase} top-0 right-0 h-4 w-4 cursor-nesw-resize`}
            onPointerDown={onResizePointerDown("ne", true)}
            onPointerMove={onResizePointerMove}
            onPointerUp={endResize}
            onPointerCancel={endResize}
          />
          <div
            role="separator"
            aria-label="Resize"
            title="Drag to resize"
            className={`${handleBase} top-0 left-0 h-4 w-4 cursor-nwse-resize`}
            onPointerDown={onResizePointerDown("nw", true)}
            onPointerMove={onResizePointerMove}
            onPointerUp={endResize}
            onPointerCancel={endResize}
          />
        </>
      ) : null}
    </div>
  );
}

function AudioMeter({ level }: { level: number }) {
  const pct = Math.round(level * 100);
  const hot = level > 0.08;
  return (
    <div
      className="flex h-1.5 w-10 items-center overflow-hidden rounded-full bg-zinc-800"
      title={hot ? "Audio receiving" : "No audio — check share-audio"}
      aria-label={hot ? "Audio receiving" : "Low or no audio"}
    >
      <div
        className={`h-full transition-[width] ${hot ? "bg-emerald-400" : "bg-zinc-500"}`}
        style={{ width: `${Math.max(4, pct)}%` }}
      />
    </div>
  );
}
